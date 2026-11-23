// Redeem the one-time code: POST { code, verifier } to
// <backend>/auth/desktop/session. The backend sets the session cookies and
// answers 303 to the frontend.
const { invoke } = window.__TAURI__.core;

const form = document.getElementById("handoff");

function fail(text) {
  document.getElementById("title").textContent = "Sign-in did not finish";
  document.getElementById("message").textContent = text;
  document.getElementById("actions").hidden = false;
}

document.getElementById("back").addEventListener("click", () => {
  invoke("cancel_login").catch(() => {});
});

invoke("take_handoff")
  .then((handoff) => {
    if (!handoff) {
      // Reloaded, or opened directly: the material is handed out once.
      fail("This sign-in was already used. Sign in again from Wafflebase.");
      return;
    }
    form.action = new URL("/auth/desktop/session", handoff.backend).toString();
    form.elements.code.value = handoff.code;
    form.elements.verifier.value = handoff.verifier;
    form.submit();
  })
  .catch((error) => fail(String(error)));
