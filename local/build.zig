const std = @import("std");

pub fn build(b: *std.Build) !void {
    // Release archives must run on CPUs older than the CI runner.
    const target = b.standardTargetOptions(.{
        .default_target = .{ .cpu_model = .baseline },
    });
    const optimize = b.standardOptimizeOption(.{});

    const exe = b.addExecutable(.{
        .name = "pararec",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });
    const embed = b.addSystemCommand(&.{"node"});
    embed.addFileArg(b.path("../scripts/embed-client.mjs"));
    embed.addDirectoryArg(b.path("../dist"));
    // Directory arguments track the path, not file contents. Track every asset
    // so rebuilding the client also refreshes the embedded production client.
    const io = b.graph.io;
    const dist = try b.build_root.handle.openDir(io, "../dist", .{ .iterate = true });
    defer dist.close(io);
    var walker = try dist.walk(b.allocator);
    defer walker.deinit();
    while (try walker.next(io)) |entry| {
        if (entry.kind == .file) embed.addFileInput(b.path(b.fmt("../dist/{s}", .{entry.path})));
    }
    const assets = embed.addOutputDirectoryArg("embedded-client");
    exe.root_module.addImport("client_assets", b.createModule(.{
        .root_source_file = assets.path(b, "assets.zig"),
    }));
    b.installArtifact(exe);

    const run_step = b.step("run", "Run the local server");
    const run_cmd = b.addRunArtifact(exe);
    run_step.dependOn(&run_cmd.step);
    run_cmd.step.dependOn(b.getInstallStep());
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const exe_tests = b.addTest(.{
        .root_module = exe.root_module,
    });
    const run_exe_tests = b.addRunArtifact(exe_tests);
    const test_step = b.step("test", "Run tests");
    test_step.dependOn(&run_exe_tests.step);
}
