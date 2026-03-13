function sanitizeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function emitLog(sink, level, payload) {
  const method =
    level === "error"
      ? sink.error?.bind(sink)
      : level === "warn"
        ? sink.warn?.bind(sink)
        : (sink.info?.bind(sink) ?? sink.log?.bind(sink));

  method?.(JSON.stringify(payload));
}

function createLogger(service, options = {}) {
  const sink = options.sink ?? console;

  function log(level, event, fields = {}) {
    emitLog(sink, level, {
      timestamp: new Date().toISOString(),
      level,
      service,
      event,
      ...sanitizeFields(fields),
    });
  }

  return {
    info(event, fields) {
      log("info", event, fields);
    },
    warn(event, fields) {
      log("warn", event, fields);
    },
    error(event, fields) {
      log("error", event, fields);
    },
  };
}

module.exports = {
  createLogger,
};
