// Server picker. Validation and persistence live in Rust (`set_server`), so
// this page only collects the address and shows what the shell says.
const { invoke } = window.__TAURI__.core;

const form = document.getElementById("picker");
const input = document.getElementById("server");
const error = document.getElementById("error");
const connect = document.getElementById("connect");
const back = document.getElementById("back");
const official = document.getElementById("official");

// The server's sign-in page, where "Cancel" returns to. Only its presence
// matters here: the shell opens it, once it answers.
let start = null;

invoke("get_server")
  .then((info) => {
    start = info.start;
    if (info.origin) input.value = info.origin;
    back.hidden = !start;
    // Offered only when another server is chosen: resetting forgets it.
    official.hidden = info.official;
  })
  .catch(() => {});

back.addEventListener("click", () => {
  if (start) invoke("retry_connection").catch(() => {});
});

official.addEventListener("click", async () => {
  error.textContent = "";
  official.disabled = true;
  try {
    // On success the shell navigates this window to the official server.
    await invoke("use_official_server");
  } catch (message) {
    error.textContent = String(message);
    official.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  error.textContent = "";
  connect.disabled = true;
  try {
    // On success the shell navigates this window to the server.
    await invoke("set_server", { input: input.value });
  } catch (message) {
    error.textContent = String(message);
    connect.disabled = false;
    input.focus();
  }
});
