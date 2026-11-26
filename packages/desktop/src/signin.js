// Shown while desktop sign-in runs in the system browser, and when it fails.
const { invoke } = window.__TAURI__.core;

const title = document.getElementById("title");
const message = document.getElementById("message");
const cancel = document.getElementById("cancel");

const TEXT = {
  idle: ["Signing in…", "Starting."],
  checking: ["Signing in…", "Checking the server."],
  waiting: [
    "Continue in your browser",
    "Wafflebase opened your web browser to sign in. Finish there, and this window picks up where you left off.",
  ],
  done: ["Signed in", "Opening Wafflebase…"],
};

async function poll() {
  let status;
  try {
    status = await invoke("login_status");
  } catch {
    return;
  }
  if (status.state === "failed") {
    title.textContent = "Sign-in did not finish";
    message.textContent = status.message;
    cancel.textContent = "Back to Wafflebase";
    return; // Final: stop polling.
  }
  const [t, m] = TEXT[status.state] || TEXT.idle;
  title.textContent = t;
  message.textContent = m;
  setTimeout(poll, 1000);
}

cancel.addEventListener("click", () => {
  invoke("cancel_login").catch(() => {});
});

poll();
