const URL_CANDIDATE_PATTERN =
  /(https?:\/\/[^\s"'<>，。！？；,]+|www\.[^\s"'<>，。！？；,]+|localhost(?::\d+)?(?:\/[^\s"'<>，。！？；,]*)?|(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/[^\s"'<>，。！？；,]*)?|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>，。！？；,]*)?)/i;

export const extractUrlCandidate = (text: string) => {
  const match = text.match(URL_CANDIDATE_PATTERN);
  return match?.[0] ?? "";
};

export const normalizeHttpUrl = (rawUrl: string) => {
  const candidate = rawUrl.trim();

  if (!candidate) {
    return {
      ok: false as const,
      message: "缺少要打开的网址。",
    };
  }

  if (
    /^(?:javascript|data|file|chrome|chrome-extension|about|edge|moz-extension):/i.test(
      candidate,
    )
  ) {
    return {
      ok: false as const,
      message: "仅支持打开 http 或 https 网页。",
    };
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const url = new URL(withProtocol);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        ok: false as const,
        message: "仅支持打开 http 或 https 网页。",
      };
    }

    if (!url.hostname) {
      return {
        ok: false as const,
        message: "网址格式不完整，请提供主机名。",
      };
    }

    return {
      ok: true as const,
      url: url.toString(),
    };
  } catch {
    return {
      ok: false as const,
      message: "网址格式无效。",
    };
  }
};
