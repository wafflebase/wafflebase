// Shown while the chosen server does not answer. The shell probes it on a
// backoff and opens it as soon as it answers (`connection.rs`), so this page
// only reports what the shell says and offers a way to hurry or leave.
const { invoke } = window.__TAURI__.core;

const title = document.getElementById("title");
const message = document.getElementById("message");
const retry = document.getElementById("retry");
const again = document.getElementById("again");
const change = document.getElementById("change");

// Why the server is out of reach, in plain words. `navigator.onLine` false
// overrides them all: it is the likeliest cause and the easiest to fix.
const CAUSE = {
  dns: (origin) =>
    `The address ${origin} could not be found. Check that it is spelled right and that this computer is online.`,
  connect: (origin) =>
    `Could not connect to ${origin}. The server may be down, or a network that asks you to sign in first (hotel or café Wi-Fi) may be in the way.`,
  timeout: (origin) =>
    `${origin} did not answer. The server may be down, or the network may be slow or blocking it.`,
  closed: (origin) =>
    `${origin} closed the connection without answering. The server may be restarting.`,
  load: (origin) => `${origin} answered, but the window could not open it.`,
};

function host(origin) {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

// Whether a status has been read yet. Only the first one can mean "nothing
// is running": a later `idle` is the server answering while the shell
// replaces this page with it, and retrying then would open it twice.
let first = true;

function retryNow() {
  again.disabled = true;
  invoke("retry_connection").catch(() => {});
}

// The title and message sit in the live region; writing the same text on
// every poll could make a screen reader repeat it, so write only changes.
function say(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

async function poll() {
  let status;
  try {
    status = await invoke("connection_status");
  } catch {
    setTimeout(poll, 1000);
    return;
  }
  const origin = status.origin || "the server";
  if (status.state === "unreachable") {
    say(title, `Can't reach ${host(origin)}`);
    say(
      message,
      navigator.onLine
        ? (CAUSE[status.cause] || CAUSE.connect)(origin)
        : "This computer is not connected to the internet. Wafflebase opens as soon as it is.",
    );
    const secs = status.retryInSecs;
    retry.textContent = secs > 0 ? `Trying again in ${secs} s.` : "Trying again…";
    retry.hidden = false;
    again.hidden = false;
    again.disabled = false;
  } else {
    say(title, `Connecting to ${host(origin)}…`);
    say(
      message,
      status.state === "opening" ? "The server answered. Opening Wafflebase…" : "This can take a few seconds.",
    );
    retry.hidden = true;
    again.disabled = true;
    // Reached with no attempt running (Back from another page): start one.
    if (status.state === "idle" && first) retryNow();
  }
  first = false;
  setTimeout(poll, 500);
}

again.addEventListener("click", retryNow);

change.addEventListener("click", () => {
  // Loading the picker stops the probe (`Connection::page_loaded`).
  window.location.href = "index.html";
});

// The network came back: no need to wait out the backoff.
window.addEventListener("online", retryNow);

poll();
