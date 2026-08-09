import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDefaultSpeakers,
  updateSpeakersForProgramStructure
} from "./transcribe-settings";

test("没有自定义说话人时随节目结构更新默认角色", () => {
  assert.deepEqual(
    updateSpeakersForProgramStructure("auto", [], "interview"),
    buildDefaultSpeakers("interview")
  );
  assert.deepEqual(
    updateSpeakersForProgramStructure(
      "interview",
      buildDefaultSpeakers("interview"),
      "roundtable"
    ),
    buildDefaultSpeakers("roundtable")
  );
});

test("已经填写的说话人不会因切换节目结构被覆盖", () => {
  const customizedSpeakers = buildDefaultSpeakers("interview").map(
    (speaker, index) => (index === 0 ? { ...speaker, name: "小王" } : speaker)
  );
  const nextSpeakers = updateSpeakersForProgramStructure(
    "interview",
    customizedSpeakers,
    "roundtable"
  );

  assert.equal(nextSpeakers[0]?.name, "小王");
  assert.equal(nextSpeakers[1]?.name, "嘉宾");
  assert.equal(nextSpeakers[2]?.name, "嘉宾 B");
});
