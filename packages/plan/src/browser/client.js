const credential = location.hash.slice(1);
const main = document.querySelector("#planning");
const error = document.querySelector("#error");
/** @typedef {{ html: string; version: number; roundId: string; revision: number; focus: string }} Snapshot */
/** @type {Snapshot | undefined} */
let snapshot;
let review = false;
let busy = false;
let dirty = false;
let dirtyField = "custom";
/** @type {ReturnType<typeof setTimeout> | undefined} */
let editTimer;
/** @type {{ field: string; questionId: string; roundId: string } | undefined} */
let recovery;

class RequestFailure extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** @param {Record<string, unknown>} [action] @returns {Promise<Snapshot>} */
async function request(action) {
  if (action !== undefined && snapshot === undefined) {
    throw new Error("Planning state has not loaded.");
  }
  const response = await fetch(
    `${action === undefined ? "/state" : "/action"}?review=${review ? "1" : "0"}`,
    {
      method: action === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${credential}`, "Content-Type": "application/json" },
      ...(action === undefined
        ? {}
        : {
            body: JSON.stringify({
              version: snapshot?.version,
              roundId: snapshot?.roundId,
              revision: snapshot?.revision,
              action,
            }),
          }),
    },
  );
  if (!response.ok) {
    const failure = await response.text();
    throw new RequestFailure(
      response.status,
      `The Pi request failed: ${failure}. Reopen the browser from /plan-ui or switch to terminal.`,
    );
  }
  /** @type {unknown} */
  const value = await response.json();
  if (
    typeof value !== "object" ||
    value === null ||
    !("html" in value) ||
    typeof value.html !== "string" ||
    !("version" in value) ||
    typeof value.version !== "number"
  ) {
    throw new Error("Invalid response from Pi.");
  }
  return {
    html: value.html,
    version: value.version,
    roundId: "roundId" in value && typeof value.roundId === "string" ? value.roundId : "",
    revision: "revision" in value && typeof value.revision === "number" ? value.revision : 0,
    focus: "focus" in value && typeof value.focus === "string" ? value.focus : "",
  };
}

/** @param {Snapshot} next */
function show(next) {
  snapshot = next;
  if (main !== null) {
    main.innerHTML = next.html;
  }
}
/** @param {unknown} failure */
function report(failure) {
  if (error !== null) {
    error.textContent = failure instanceof Error ? failure.message : String(failure);
  }
}

async function saveDraft() {
  clearTimeout(editTimer);
  if (!dirty || busy || snapshot === undefined) {
    return;
  }
  busy = true;
  const source = { field: dirtyField, questionId: snapshot.focus, roundId: snapshot.roundId };
  try {
    const editor = document.querySelector(`#${dirtyField}`);
    if (!(editor instanceof HTMLTextAreaElement)) {
      return;
    }
    const value = editor.value;
    const next = await request(
      dirtyField === "feedback"
        ? { type: "edit-feedback", text: value }
        : { type: "edit", questionId: snapshot.focus, unfinished: value },
    );
    snapshot = next;
    dirty = editor.value !== value;
    if (error !== null) {
      error.textContent = "";
    }
  } catch (failure) {
    report(failure);
    if (failure instanceof RequestFailure && failure.status === 409) {
      const editor = document.querySelector(`#${source.field}`);
      const recovered = document.querySelector("#recovery-text");
      const panel = document.querySelector("#recovery-panel");
      if (
        editor instanceof HTMLTextAreaElement &&
        recovered instanceof HTMLTextAreaElement &&
        panel instanceof HTMLElement
      ) {
        recovered.value = editor.value;
        recovery = source;
        panel.hidden = false;
        show(await request());
        dirty = false;
      }
    }
  } finally {
    busy = false;
  }
}

document.querySelector("#restore-draft")?.addEventListener("click", () => {
  if (busy || recovery === undefined || snapshot === undefined) {
    return;
  }
  const source = recovery;
  const editor = document.querySelector("#recovery-text");
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }
  if (source.roundId !== snapshot.roundId) {
    report(
      new Error(
        "This text belongs to an earlier interaction. Copy it into the current question or feedback field.",
      ),
    );
    return;
  }
  busy = true;
  request(
    source.field === "feedback"
      ? { type: "edit-feedback", text: editor.value }
      : { type: "edit", questionId: source.questionId, unfinished: editor.value },
  )
    .then((next) => {
      show(next);
      recovery = undefined;
      const panel = document.querySelector("#recovery-panel");
      if (panel instanceof HTMLElement) {
        panel.hidden = true;
      }
      if (error !== null) {
        error.textContent =
          "Text restored as an unsubmitted draft. Review and explicitly accept it before submitting.";
      }
    })
    .catch(report)
    .finally(() => {
      busy = false;
    });
});

main?.addEventListener("input", (event) => {
  if (
    event.target instanceof HTMLTextAreaElement &&
    ["custom", "feedback"].includes(event.target.id)
  ) {
    dirtyField = event.target.id;
    dirty = true;
    clearTimeout(editTimer);
    editTimer = setTimeout(() => {
      saveDraft().catch(report);
    }, 200);
  }
});
main?.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }
  const button = event.target.closest("button[data-action]");
  if (!(button instanceof HTMLButtonElement) || busy) {
    return;
  }
  (async () => {
    await saveDraft();
    if (dirty || snapshot === undefined) {
      return;
    }
    busy = true;
    try {
      const type = button.dataset.action;
      const custom = document.querySelector("#custom");
      const clarification = document.querySelector("#clarification");
      const feedback = document.querySelector("#feedback");
      /** @type {Record<string, unknown> | undefined} */
      let action;
      if (type === "review") {
        review = !review;
      } else if (type === "focus") {
        action = { type, questionId: button.dataset.id };
        review = false;
      } else if (type === "answer") {
        action = { type, questionId: snapshot.focus, answer: { optionId: button.dataset.id } };
      } else if (type === "custom" && custom instanceof HTMLTextAreaElement) {
        action = { type: "answer", questionId: snapshot.focus, answer: { custom: custom.value } };
      } else if (type === "clarify" && clarification instanceof HTMLTextAreaElement) {
        action = {
          type,
          questionId: snapshot.focus,
          request: clarification.value,
          id: crypto.randomUUID(),
        };
      } else if (type === "feedback" && feedback instanceof HTMLTextAreaElement) {
        action = { type, text: feedback.value };
      } else {
        action = { type };
      }
      show(await request(action));
      if (error !== null) {
        error.textContent = "";
      }
      main.querySelector("h1")?.scrollIntoView({ block: "nearest" });
    } catch (failure) {
      report(failure);
    } finally {
      busy = false;
    }
  })().catch(report);
});

setInterval(() => {
  if (busy || dirty || document.activeElement?.tagName === "TEXTAREA") {
    return;
  }
  busy = true;
  request()
    .then((next) => {
      if (
        snapshot === undefined ||
        next.version !== snapshot.version ||
        next.html !== snapshot.html
      ) {
        show(next);
      }
    })
    .catch(report)
    .finally(() => {
      busy = false;
    });
}, 1000);
request().then(show).catch(report);
