const std = @import("std");

pub const Content = struct { id: []const u8, text: []const u8 };
pub const RightContent = struct { id: []const u8, text: []const u8, children: []const Container };
pub const Container = struct { id: []const u8, left: []const Content, right: RightContent };
pub const WidthRate = struct { left: f64, right: f64 };
pub const Config = struct {
    showTitles: bool = true,
    maxWidth: f64 = 1100,
    outerWidthRate: WidthRate = .{ .left = 35, .right = 65 },
    innerWidthRate: WidthRate = .{ .left = 35, .right = 65 },
};
pub const TextLink = struct { id: []const u8, sourceId: []const u8, start: usize, end: usize, targets: []const []const u8 };
pub const Schema = struct {
    links: []const TextLink = &.{},
    version: u32,
    title: []const u8 = "document",
    config: Config = .{},
    root: []const Container,
};

pub fn defaultTitle(filename: []const u8) []const u8 {
    const basename = std.fs.path.basename(filename);
    return basename[0 .. basename.len - std.fs.path.extension(basename).len];
}
pub const max_container_depth = 64;
pub const max_json_depth = 256;

pub const max_document_size = 128 * 1024 * 1024;
pub const max_body_size = 32 * 1024 * 1024;

pub fn parse(gpa: std.mem.Allocator, bytes: []const u8) !std.json.Parsed(Schema) {
    return parseWithDefaultTitle(gpa, bytes, "document");
}

// A wrapper distinguishes an omitted title from an explicit null without a second JSON tree.
const InputTitle = struct {
    value: ?[]const u8 = null,
    pub fn jsonParse(gpa: std.mem.Allocator, source: anytype, options: std.json.ParseOptions) !InputTitle {
        return .{ .value = try std.json.innerParse([]const u8, gpa, source, options) };
    }
};
const InputSchema = struct {
    links: []const TextLink = &.{},
    version: u32,
    title: InputTitle = .{},
    config: Config = .{},
    root: []const Container,
};

pub fn parseWithDefaultTitle(gpa: std.mem.Allocator, bytes: []const u8, title: []const u8) !std.json.Parsed(Schema) {
    if (!std.unicode.utf8ValidateSlice(bytes)) return error.InvalidUtf8;
    if (std.mem.startsWith(u8, bytes, "\xef\xbb\xbf")) return error.UnexpectedBom;
    // Bound nesting before the typed parser recurses, including in unknown fields.
    var scanner = std.json.Scanner.initCompleteInput(gpa, bytes);
    defer scanner.deinit();
    var depth: usize = 0;
    while (true) {
        switch (try scanner.next()) {
            .object_begin, .array_begin => {
                depth += 1;
                if (depth > max_json_depth) return error.MaximumDepthExceeded;
            },
            .object_end, .array_end => depth -= 1,
            .end_of_document => break,
            else => {},
        }
    }
    const parsed = try std.json.parseFromSlice(InputSchema, gpa, bytes, .{ .ignore_unknown_fields = true });
    return .{ .arena = parsed.arena, .value = .{
        .version = parsed.value.version,
        .links = parsed.value.links,
        .title = parsed.value.title.value orelse title,
        .config = parsed.value.config,
        .root = parsed.value.root,
    } };
}

pub fn validate(gpa: std.mem.Allocator, document: Schema) !void {
    if (document.version != 1) return error.UnsupportedVersion;
    if (!std.math.isFinite(document.config.maxWidth) or document.config.maxWidth <= 0) return error.InvalidMaxWidth;
    try checkText(document.title);
    for ([_]WidthRate{ document.config.outerWidthRate, document.config.innerWidthRate }) |rate| {
        if (!std.math.isFinite(rate.left) or !std.math.isFinite(rate.right) or rate.left <= 0 or rate.right <= 0) return error.InvalidWidthRate;
    }
    var ids: std.StringHashMap(void) = .init(gpa);
    defer ids.deinit();
    const Level = struct { rows: []const Container, depth: usize };
    var pending: std.ArrayList(Level) = .empty;
    defer pending.deinit(gpa);
    try pending.append(gpa, .{ .rows = document.root, .depth = 1 });
    while (pending.pop()) |level| {
        if (level.rows.len > 0 and level.depth > max_container_depth) return error.MaximumDepthExceeded;
        for (level.rows) |container| {
            try addId(&ids, container.id);
            if (container.left.len == 0) return error.EmptyLeft;
            if (std.mem.eql(u8, container.id, container.right.id)) return error.RightIdMatchesContainer;
            for (container.left) |content| {
                try addId(&ids, content.id);
                try checkText(content.text);
            }
            try addId(&ids, container.right.id);
            try checkText(container.right.text);
            try pending.append(gpa, .{ .rows = container.right.children, .depth = level.depth + 1 });
        }
    }
}

fn addId(ids: *std.StringHashMap(void), id: []const u8) !void {
    const entry = try ids.getOrPut(id);
    if (entry.found_existing) return error.DuplicateId;
}

fn checkText(text: []const u8) !void {
    if (std.mem.indexOfScalar(u8, text, '\r') != null) return error.CarriageReturn;
}

pub fn write(document: Schema, writer: *std.Io.Writer) !void {
    // Keep the existing canonical format for documents without text links.
    const output_document = .{
        .version = document.version,
        .title = document.title,
        .config = document.config,
        .root = document.root,
        .links = @as(?[]const TextLink, if (document.links.len > 0) document.links else null),
    };
    try std.json.Stringify.value(output_document, .{ .whitespace = .indent_2, .emit_null_optional_fields = false }, writer);
}

pub fn serialize(gpa: std.mem.Allocator, document: Schema) ![]u8 {
    var output: std.Io.Writer.Allocating = .init(gpa);
    defer output.deinit();
    try write(document, &output.writer);
    try output.writer.writeByte('\n');
    return output.toOwnedSlice();
}

const valid =
    \\{"version":1,"root":[{"id":"row","left":[{"id":"left","text":"日本語 👩🏽‍💻\\nsecond"}],"right":{"id":"right","text":"","children":[]}}]}
;

test "schema accepts recursive documents and drops unknown fields" {
    const parsed = try parse(std.testing.allocator, valid);
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);
    const with_unknown = try parse(std.testing.allocator, "{\"version\":1,\"root\":[],\"future\":true}");
    defer with_unknown.deinit();
    try validate(std.testing.allocator, with_unknown.value);
    const bytes = try serialize(std.testing.allocator, with_unknown.value);
    defer std.testing.allocator.free(bytes);
    const reparsed = try parse(std.testing.allocator, bytes);
    defer reparsed.deinit();
    try std.testing.expectEqualStrings("document", reparsed.value.title);
    try std.testing.expect(reparsed.value.config.showTitles);
}

test "schema rejects each invariant violation" {
    const cases = .{
        .{ "{\"version\":2,\"root\":[]}", error.UnsupportedVersion },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[],\"right\":{\"id\":\"b\",\"text\":\"\",\"children\":[]}}]}", error.EmptyLeft },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[{\"id\":\"a\",\"text\":\"\"}],\"right\":{\"id\":\"r\",\"text\":\"\",\"children\":[]}}]}", error.RightIdMatchesContainer },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[{\"id\":\"a\",\"text\":\"\"}],\"right\":{\"id\":\"a\",\"text\":\"\",\"children\":[]}}]}", error.DuplicateId },
        .{ "{\"version\":1,\"root\":[{\"id\":\"r\",\"left\":[{\"id\":\"a\",\"text\":\"\\r\"}],\"right\":{\"id\":\"b\",\"text\":\"\",\"children\":[]}}]}", error.CarriageReturn },
    };
    inline for (cases) |case| {
        const parsed = try parse(std.testing.allocator, case[0]);
        defer parsed.deinit();
        try std.testing.expectError(case[1], validate(std.testing.allocator, parsed.value));
    }
}

test "schema rejects invalid UTF-8 and missing fields" {
    try std.testing.expectError(error.InvalidUtf8, parse(std.testing.allocator, "\xff"));
    try std.testing.expectError(error.UnexpectedBom, parse(std.testing.allocator, "\xef\xbb\xbf{\"version\":1,\"root\":[]}"));
    try std.testing.expectError(error.MissingField, parse(std.testing.allocator, "{\"version\":1}"));
}

test "document settings survive serialization and validate ratios" {
    const parsed = try parse(std.testing.allocator, "{\"version\":1,\"root\":[],\"title\":\"Notes\",\"config\":{\"showTitles\":false,\"outerWidthRate\":{\"left\":2,\"right\":3},\"innerWidthRate\":{\"left\":1,\"right\":4}}}");
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);
    const bytes = try serialize(std.testing.allocator, parsed.value);
    defer std.testing.allocator.free(bytes);
    const roundtrip = try parse(std.testing.allocator, bytes);
    defer roundtrip.deinit();
    try std.testing.expectEqualStrings("Notes", roundtrip.value.title);
    try std.testing.expectEqual(false, roundtrip.value.config.showTitles);
    try std.testing.expectEqual(@as(f64, 4), roundtrip.value.config.innerWidthRate.right);
    try std.testing.expectError(error.InvalidWidthRate, validate(std.testing.allocator, .{ .version = 1, .root = &.{}, .config = .{ .outerWidthRate = .{ .left = 0, .right = 1 } } }));
    try std.testing.expectEqualStrings("my.notes", defaultTitle("/tmp/my.notes.json"));
    try std.testing.expectEqualStrings("notes", defaultTitle("notes"));
}

test "maxWidth defaults and validation" {
    const parsed = try parse(std.testing.allocator, "{\"version\":1,\"root\":[],\"config\":{\"maxWidth\":900}}");
    defer parsed.deinit();
    try validate(std.testing.allocator, parsed.value);
    const bytes = try serialize(std.testing.allocator, parsed.value);
    defer std.testing.allocator.free(bytes);
    const roundtrip = try parse(std.testing.allocator, bytes);
    defer roundtrip.deinit();
    try std.testing.expectEqual(@as(f64, 900), roundtrip.value.config.maxWidth);
    try std.testing.expectEqual(@as(f64, 1100), (Config{}).maxWidth);
    for ([_]f64{ 0, -1, std.math.inf(f64), std.math.nan(f64) }) |width| {
        try std.testing.expectError(error.InvalidMaxWidth, validate(std.testing.allocator, .{ .version = 1, .root = &.{}, .config = .{ .maxWidth = width } }));
    }
}

test "default title preserves explicit titles and rejects null" {
    const gpa = std.testing.allocator;
    const omitted = try parseWithDefaultTitle(gpa, "{\"version\":1,\"root\":[]}", "filename");
    defer omitted.deinit();
    try std.testing.expectEqualStrings("filename", omitted.value.title);
    const explicit = try parseWithDefaultTitle(gpa, "{\"version\":1,\"title\":\"document\",\"root\":[]}", "filename");
    defer explicit.deinit();
    try std.testing.expectEqualStrings("document", explicit.value.title);
    const escaped = try parseWithDefaultTitle(gpa, "{\"version\":1,\"ti\\u0074le\":\"\",\"root\":[]}", "filename");
    defer escaped.deinit();
    try std.testing.expectEqualStrings("", escaped.value.title);
    try std.testing.expectError(error.UnexpectedToken, parseWithDefaultTitle(gpa, "{\"version\":1,\"title\":null,\"root\":[]}", "filename"));
}

test "container depth boundary" {
    const gpa = std.testing.allocator;
    var rows: [max_container_depth + 1]Container = undefined;
    var left: [max_container_depth + 1]Content = undefined;
    var ids: [max_container_depth + 1][3][32]u8 = undefined;
    for (0..rows.len) |at| {
        left[at] = .{ .id = try std.fmt.bufPrint(&ids[at][0], "left-{d}", .{at}), .text = "" };
        rows[at] = .{
            .id = try std.fmt.bufPrint(&ids[at][1], "row-{d}", .{at}),
            .left = left[at..][0..1],
            .right = .{ .id = try std.fmt.bufPrint(&ids[at][2], "right-{d}", .{at}), .text = "", .children = if (at == 0) &.{} else rows[at - 1 ..][0..1] },
        };
    }
    const boundary: Schema = .{ .version = 1, .root = rows[max_container_depth - 1 ..][0..1] };
    try validate(gpa, boundary);
    const bytes = try serialize(gpa, boundary);
    defer gpa.free(bytes);
    const parsed = try parse(gpa, bytes);
    defer parsed.deinit();
    try validate(gpa, parsed.value);
    try std.testing.expectError(error.MaximumDepthExceeded, validate(gpa, .{ .version = 1, .root = rows[max_container_depth..][0..1] }));
}

test "excessive unknown JSON nesting is rejected before typed parsing" {
    const gpa = std.testing.allocator;
    var json: std.Io.Writer.Allocating = .init(gpa);
    defer json.deinit();
    try json.writer.writeAll("{\"version\":1,\"root\":[],\"unknown\":");
    try json.writer.splatByteAll('[', max_json_depth);
    try json.writer.writeByte('0');
    try json.writer.splatByteAll(']', max_json_depth);
    try json.writer.writeByte('}');
    try std.testing.expectError(error.MaximumDepthExceeded, parse(gpa, json.written()));
}

test "text links survive disk serialization" {
    const gpa = std.testing.allocator;
    const parsed = try parse(gpa, "{\"version\":1,\"root\":[],\"links\":[{\"id\":\"link\",\"sourceId\":\"source\",\"start\":0,\"end\":5,\"targets\":[\"target\"]}]}");
    defer parsed.deinit();
    const bytes = try serialize(gpa, parsed.value);
    defer gpa.free(bytes);
    const restored = try parse(gpa, bytes);
    defer restored.deinit();
    try std.testing.expectEqual(@as(usize, 1), restored.value.links.len);
    try std.testing.expectEqualStrings("target", restored.value.links[0].targets[0]);
}

test "empty text links are omitted from canonical output" {
    const gpa = std.testing.allocator;
    const omitted = try parse(gpa, "{\"version\":1,\"root\":[]}");
    defer omitted.deinit();
    const explicit = try parse(gpa, "{\"version\":1,\"root\":[],\"links\":[]}");
    defer explicit.deinit();
    const omitted_bytes = try serialize(gpa, omitted.value);
    defer gpa.free(omitted_bytes);
    const explicit_bytes = try serialize(gpa, explicit.value);
    defer gpa.free(explicit_bytes);
    try std.testing.expectEqualStrings(omitted_bytes, explicit_bytes);
    try std.testing.expect(std.mem.indexOf(u8, omitted_bytes, "\"links\"") == null);
}
