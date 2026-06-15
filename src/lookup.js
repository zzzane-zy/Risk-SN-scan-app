export const TARGET_SN_PATTERN = /^P[0-9A-Z]{18,}$/;

export const RESULT_RISK = "risk";
export const RESULT_SAFE = "safe";
export const RESULT_NON_CHECK = "non_check";

export const CHECK_PRODUCT_PREFIXES = [
  "P0101000469", "P0101000470", "P0101000471", "P0101000475",
  "P0101000476", "P0101000477", "P0101000479", "P0101000480",
  "P0101000481", "P0101000482", "P0101000483", "P0101000484",
  "P0101000485", "P0101000486", "P0101000487", "P0101000488",
  "P0101000489", "P0101000490", "P0101000695", "P0101000491",
  "P0101000492", "P0101000493", "P0101000494", "P0101000495",
  "P0101000496", "P0101000497", "P0101000498", "P0101000499",
  "P0101000500", "P0101000501", "P0101000502", "P0101000503",
  "P0101000504", "P0101000505", "P0101000506", "P0101000507",
  "P0101000508", "P0101000512", "P0101000513", "P0101000514",
  "P0101000515", "P0101000516", "P0101000517", "P0101000518",
  "P0101000519", "P0101000520", "P0101000521", "P0101000522",
  "P0101000523", "P0101000524", "P0101000525", "P0101000526",
  "P0101000527", "P0101000528", "P0101000529", "P0101000626",
  "P0101000627", "P0101000628", "P0101000629", "P0101000630",
  "P0101000631", "P0101000632", "P0101000633", "P0101000634",
  "P0101000635", "P0101000636", "P0101000637", "P0101000638",
  "P0101000639", "P0101000640", "P0101000641", "P0101000642",
  "P0101000643"
];

const CHECK_PRODUCT_PREFIX_SET = new Set(CHECK_PRODUCT_PREFIXES);

export function normalizeSerialNumber(value) {
  let normalized = String(value ?? "").trim();
  if (normalized.startsWith("\uFEFF")) {
    normalized = normalized.slice(1).trim();
  }
  return normalized;
}

export function isTargetSn(value) {
  return TARGET_SN_PATTERN.test(normalizeSerialNumber(value));
}

export function isCheckProductSn(value) {
  const code = normalizeSerialNumber(value);
  for (const prefix of CHECK_PRODUCT_PREFIX_SET) {
    if (code.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export function validateSerialNumber(rawValue) {
  const code = normalizeSerialNumber(rawValue);

  if (!code) {
    return {
      code,
      valid: false,
      title: "SN 格式错误",
      message: "没有可核验的 SN 内容。"
    };
  }

  if (!TARGET_SN_PATTERN.test(code)) {
    return {
      code,
      valid: false,
      title: "SN 格式错误",
      message: `SN 必须匹配 P[0-9A-Z]{18,}，当前为 ${code.length} 位。`
    };
  }

  return {
    code,
    valid: true,
    title: "",
    message: ""
  };
}

export function parseRiskCsv(csvText) {
  return String(csvText ?? "")
    .split(/\r?\n/)
    .map(normalizeSerialNumber)
    .filter((code) => validateSerialNumber(code).valid);
}

export function buildRiskIndex(serialNumbers) {
  return new Set(
    serialNumbers
      .map(normalizeSerialNumber)
      .filter((code) => validateSerialNumber(code).valid)
  );
}

export function checkSerialNumber(rawValue, riskIndex) {
  const validation = validateSerialNumber(rawValue);
  if (!validation.valid) {
    return {
      code: validation.code || "--",
      invalid: true,
      matched: false,
      uploadable: false,
      result: "invalid",
      title: validation.title,
      message: validation.message
    };
  }

  const code = validation.code;

  if (!isCheckProductSn(code)) {
    return {
      code,
      invalid: false,
      matched: false,
      uploadable: false,
      result: RESULT_NON_CHECK,
      title: "非待校验产品",
      message: "该 SN 不属于当前待校验 SKU，不上传。"
    };
  }

  const matched = riskIndex.has(code);

  return {
    code,
    invalid: false,
    matched,
    uploadable: true,
    result: matched ? RESULT_RISK : RESULT_SAFE,
    title: matched ? "风险" : "正常",
    message: matched ? "该 SN 命中风险清单，请拦截并复核。" : "该 SN 未命中风险清单。",
  };
}
