import test from "node:test";
import assert from "node:assert/strict";

import {
  RESULT_NON_CHECK,
  RESULT_RISK,
  RESULT_SAFE,
  buildRiskIndex,
  checkSerialNumber,
  isCheckProductSn,
  isTargetSn,
  normalizeSerialNumber,
  parseRiskCsv,
  validateSerialNumber
} from "../src/lookup.js";

test("parseRiskCsv reads valid serial numbers and ignores blanks or invalid rows", () => {
  const rows = parseRiskCsv(" P0101000482260415100054 \r\n\r\nBAD\nP0101000477260409101467 ");

  assert.deepEqual(rows, ["P0101000482260415100054", "P0101000477260409101467"]);
});

test("buildRiskIndex stores normalized valid serial numbers for exact lookup", () => {
  const index = buildRiskIndex([" P0101000482260415100054 ", "BAD", "p0101000482260415100055"]);

  assert.equal(index.has("P0101000482260415100054"), true);
  assert.equal(index.has("BAD"), false);
  assert.equal(index.has("p0101000482260415100055"), false);
});

test("validateSerialNumber follows the Android target SN rule", () => {
  assert.equal(validateSerialNumber("P0101000482260415100054").valid, true);
  assert.equal(validateSerialNumber("P0101000482ABCDEFGH1").valid, true);
  assert.equal(validateSerialNumber("P0101000482").valid, false);
  assert.equal(validateSerialNumber("p0101000482260415100054").valid, false);
  assert.equal(validateSerialNumber("X0101000482260415100054").valid, false);
});

test("target and check-product rules are separate", () => {
  assert.equal(isTargetSn("P9999999999999999999"), true);
  assert.equal(isCheckProductSn("P9999999999999999999"), false);
  assert.equal(isCheckProductSn("P0101000482260415100054"), true);
});

test("checkSerialNumber returns risk, safe, and non-check product states", () => {
  const index = buildRiskIndex(["P0101000482260415100054"]);

  assert.deepEqual(checkSerialNumber("P0101000482260415100054", index), {
    code: "P0101000482260415100054",
    invalid: false,
    matched: true,
    uploadable: true,
    result: RESULT_RISK,
    title: "风险",
    message: "该 SN 命中风险清单，请拦截并复核。"
  });

  assert.deepEqual(checkSerialNumber("P0101000482260415100000", index), {
    code: "P0101000482260415100000",
    invalid: false,
    matched: false,
    uploadable: true,
    result: RESULT_SAFE,
    title: "正常",
    message: "该 SN 未命中风险清单。"
  });

  assert.deepEqual(checkSerialNumber("P9999999999999999999", index), {
    code: "P9999999999999999999",
    invalid: false,
    matched: false,
    uploadable: false,
    result: RESULT_NON_CHECK,
    title: "非待校验产品",
    message: "该 SN 不属于当前待校验 SKU，不上传。"
  });
});

test("normalizeSerialNumber trims scan noise without changing case", () => {
  assert.equal(normalizeSerialNumber(" \nP0101000482260415100054\t"), "P0101000482260415100054");
  assert.equal(normalizeSerialNumber(" p0101000482260415100054 "), "p0101000482260415100054");
});
