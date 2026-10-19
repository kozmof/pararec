const std = @import("std");

pub fn build(b: *std.Build) void {
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
    const embed = b.addSystemCommand(&.{ "node", b.pathFromRoot("../scripts/embed-client.mjs") });
    embed.addDirectoryArg(b.path("../dist"));
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
