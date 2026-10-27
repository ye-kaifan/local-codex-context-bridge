#import <AppKit/AppKit.h>
#import <signal.h>
#import <sys/stat.h>
#import <unistd.h>

static NSString *BundleID = @"";

@interface BridgeSupervisor : NSObject
@property(nonatomic, copy) NSArray<NSString *> *command;
@property(nonatomic, copy) NSString *statePath;
@property(nonatomic, strong) NSTask *child;
@property(nonatomic) BOOL wanted;
@property(nonatomic) BOOL childStopping;
@property(nonatomic) BOOL shuttingDown;
@property(nonatomic) BOOL retryScheduled;
@property(nonatomic) double retryDelay;
- (void)setAppRunning:(BOOL)running;
- (void)shutdown;
@end

@implementation BridgeSupervisor
- (void)recordState {
    if (!self.statePath.length) return;
    NSDictionary *state = @{
        @"bundle_id": BundleID, @"app_running": @(self.wanted),
        @"watcher_pid": @(getpid()),
        @"tunnel_pid": self.child.running ? @(self.child.processIdentifier) : [NSNull null],
        @"state": self.wanted ? (self.child.running ? @"running" : @"starting") : @"waiting_for_app",
        @"updated_at": @([NSDate date].timeIntervalSince1970)
    };
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingPrettyPrinted error:NULL];
    [data writeToFile:self.statePath options:NSDataWritingAtomic error:NULL];
}
- (void)scheduleRetry:(double)delay {
    if (self.retryScheduled || self.shuttingDown || !self.wanted) return;
    self.retryScheduled = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(delay * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        self.retryScheduled = NO;
        if (self.wanted && !self.shuttingDown && !self.child) [self startChild];
    });
}
- (void)startChild {
    if (!self.wanted || self.shuttingDown || self.child) return;
    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:self.command.firstObject];
    task.arguments = [self.command subarrayWithRange:NSMakeRange(1, self.command.count - 1)];
    __weak BridgeSupervisor *weakSelf = self;
    task.terminationHandler = ^(NSTask *finished) {
        dispatch_async(dispatch_get_main_queue(), ^{
            BridgeSupervisor *owner = weakSelf;
            if (!owner || owner.child != finished) return;
            BOOL wasStopping = owner.childStopping;
            owner.child = nil;
            owner.childStopping = NO;
            [owner recordState];
            if (owner.shuttingDown) exit(0);
            if (owner.wanted) [owner scheduleRetry:wasStopping ? 0.1 : owner.retryDelay];
        });
    };
    self.child = task;
    self.childStopping = NO;
    NSError *error = nil;
    if (![task launchAndReturnError:&error]) {
        self.child = nil;
        fprintf(stderr, "Bridge child could not start (code %ld).\n", (long)error.code);
        [self recordState];
        [self scheduleRetry:self.retryDelay];
        return;
    }
    fprintf(stderr, "Watched app running; started Bridge child pid=%d.\n", task.processIdentifier);
    [self recordState];
}
- (void)stopChild {
    NSTask *task = self.child;
    if (!task || !task.running || self.childStopping) return;
    self.childStopping = YES;
    fprintf(stderr, "Watched app stopped or watcher stopping; terminating owned child pid=%d.\n", task.processIdentifier);
    [task terminate];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        if (self.child == task && task.running) kill(task.processIdentifier, SIGKILL);
    });
}
- (void)setAppRunning:(BOOL)running {
    self.wanted = running;
    if (running) [self startChild]; else [self stopChild];
    [self recordState];
}
- (void)shutdown {
    self.shuttingDown = YES;
    self.wanted = NO;
    if (!self.child || !self.child.running) exit(0);
    [self stopChild];
}
@end

@interface AppLifecycle : NSObject
@property(nonatomic, strong) BridgeSupervisor *supervisor;
- (void)reconcile;
@end
@implementation AppLifecycle
- (void)reconcile {
    BOOL running = NO;
    for (NSRunningApplication *app in NSWorkspace.sharedWorkspace.runningApplications) {
        if (!app.terminated && [app.bundleIdentifier isEqualToString:BundleID]) running = YES;
    }
    [self.supervisor setAppRunning:running];
}
- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
    (void)keyPath; (void)object; (void)change; (void)context;
    dispatch_async(dispatch_get_main_queue(), ^{ [self reconcile]; });
}
@end

static void pump(double seconds) {
    [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
}
static BOOL waitFor(BOOL (^condition)(void), double seconds) {
    NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:seconds];
    while (!condition() && deadline.timeIntervalSinceNow > 0) pump(0.02);
    return condition();
}
static int selfTest(void) {
    BridgeSupervisor *owner = [BridgeSupervisor new];
    owner.command = @[@"/bin/sleep", @"60"];
    owner.retryDelay = 0.1;
    owner.statePath = @"";
    [owner setAppRunning:NO];
    BOOL ok = owner.child == nil;
    [owner setAppRunning:YES];
    ok = ok && owner.child.running;
    pid_t first = owner.child.processIdentifier;
    [owner setAppRunning:YES];
    ok = ok && owner.child.processIdentifier == first;
    [owner setAppRunning:NO];
    ok = waitFor(^BOOL{ return owner.child == nil; }, 3) && ok;
    [owner setAppRunning:YES];
    ok = ok && owner.child.running && owner.child.processIdentifier != first;
    pid_t crashed = owner.child.processIdentifier;
    kill(crashed, SIGKILL);
    ok = waitFor(^BOOL{ return owner.child.running && owner.child.processIdentifier != crashed; }, 3) && ok;
    [owner setAppRunning:NO];
    ok = waitFor(^BOOL{ return owner.child == nil; }, 3) && ok;
    pump(0.2);
    ok = ok && owner.child == nil;
    if (owner.child.running) { [owner.child terminate]; [owner.child waitUntilExit]; }
    puts(ok ? "PASS: app absent -> no child; launch -> one child; quit -> child stops; crash -> retry; relaunch -> child starts." : "FAIL: lifecycle self-test");
    return ok ? 0 : 1;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 2 && strcmp(argv[1], "--self-test") == 0) return selfTest();
        if (argc != 4) { fputs("Usage: app-lifecycle <background-script> <state-json> <bundle-id>\n", stderr); return 2; }
        BundleID = [NSString stringWithUTF8String:argv[3]];
        umask(0077);
        BridgeSupervisor *owner = [BridgeSupervisor new];
        owner.command = @[@"/bin/sh", [NSString stringWithUTF8String:argv[1]]];
        owner.statePath = [NSString stringWithUTF8String:argv[2]];
        owner.retryDelay = 30;
        AppLifecycle *lifecycle = [AppLifecycle new];
        lifecycle.supervisor = owner;
        [NSWorkspace.sharedWorkspace addObserver:lifecycle forKeyPath:@"runningApplications" options:0 context:NULL];
        [lifecycle reconcile];
        signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN);
        dispatch_source_t term = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGTERM, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(term, ^{ [owner shutdown]; }); dispatch_resume(term);
        dispatch_source_t interrupt = dispatch_source_create(DISPATCH_SOURCE_TYPE_SIGNAL, SIGINT, 0, dispatch_get_main_queue());
        dispatch_source_set_event_handler(interrupt, ^{ [owner shutdown]; }); dispatch_resume(interrupt);
        [NSRunLoop.currentRunLoop run];
    }
    return 0;
}
