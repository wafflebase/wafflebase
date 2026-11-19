---
title: Sign-in providers
description: Configure GitHub, GitHub Enterprise, and Google sign-in for a self-hosted Wafflebase, and make cookies and CLI sign-in work over HTTPS.
type: how-to
---

# Sign-in providers

Configure who can sign in to your Wafflebase instance: GitHub (required), GitHub Enterprise Server, and Google (optional).

People sign in with an email address their provider has verified. The first sign-in creates the account and its first workspace. The same email reaches the same account through either provider.

::: info Before you start
- You need the backend's public URL, for example `https://api.example.com`. Locally it is `http://localhost:3000`.
- Changes take effect when you restart the backend.
:::

## Set up GitHub sign-in

1. Open [GitHub Developer Settings](https://github.com/settings/developers) and click **New OAuth App**.
2. Set **Homepage URL** to your frontend URL, for example `https://app.example.com`.
3. Set **Authorization callback URL** to `https://api.example.com/auth/github/callback`.
4. Register the app, then generate a client secret.
5. Add the values to the backend configuration:

   ```env
   GITHUB_CLIENT_ID=your_client_id
   GITHUB_CLIENT_SECRET=your_client_secret
   GITHUB_CALLBACK_URL=https://api.example.com/auth/github/callback
   FRONTEND_URL=https://app.example.com
   ```

6. Restart the backend.

The sign-in page shows **Continue with GitHub**. Use a separate OAuth app for local development, with the callback `http://localhost:3000/auth/github/callback`.

## Use GitHub Enterprise

1. Create the OAuth app on your GitHub Enterprise Server instance, with the same callback URL as above.
2. Set the client ID, secret, and callback URL as for github.com.
3. Point all four endpoints at your instance:

   ```env
   GITHUB_AUTHORIZATION_URL=https://ghe.example.com/login/oauth/authorize
   GITHUB_TOKEN_URL=https://ghe.example.com/login/oauth/access_token
   GITHUB_USER_PROFILE_URL=https://ghe.example.com/api/v3/user
   GITHUB_USER_EMAIL_URL=https://ghe.example.com/api/v3/user/emails
   ```

4. Restart the backend.

Set all four. If `GITHUB_USER_EMAIL_URL` is missing, sign-in fails with `Bad credentials`; see [troubleshooting](/developers/self-hosting/troubleshooting#github-enterprise-sign-in-fails-with-bad-credentials).

## Set up Google sign-in

1. In the Google Cloud console, create an OAuth client ID of type **Web application**.
2. Add `https://api.example.com/auth/google/callback` as an authorized redirect URI.
3. Add the three values to the backend configuration:

   ```env
   GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your_client_secret
   GOOGLE_CALLBACK_URL=https://api.example.com/auth/google/callback
   ```

4. Restart the backend.

The sign-in page shows **Continue with Google** below the GitHub button. All three variables are required. With one missing, the button does not appear and the backend logs `Google sign-in is disabled:` followed by the missing names.

![Sign-in page with Continue with GitHub and Continue with Google buttons](/images/developers/self-hosting/sign-in-providers.png)

## Serve sign-in over HTTPS

The backend decides whether its cookies are `Secure` (and use the `__Host-` prefix) in this order:

1. `COOKIE_SECURE`: `true`/`1` means secure, `false`/`0` means not secure.
2. The scheme of `GITHUB_CALLBACK_URL`: `https://` means secure.
3. With no callback URL set: secure when `NODE_ENV=production`.

To get this right:

1. Set `GITHUB_CALLBACK_URL` to the `https://` URL your users reach, even when TLS ends at a proxy.
2. If you cannot, set `COOKIE_SECURE=true`.

`GOOGLE_CALLBACK_URL` does not affect this. An HTTPS deployment that leaves `GITHUB_CALLBACK_URL` unset and uses only Google should set `COOKIE_SECURE=true`. With `NODE_ENV=production` and a non-loopback `http://` callback URL, the backend logs a warning at the first sign-in that cookies are issued without `Secure`.

## Allow CLI sign-in

`wafflebase login` signs in through the browser with GitHub. Point the CLI at your backend:

```bash
wafflebase --server https://api.example.com login
```

The backend allows CLI sign-in only when its cookies are `Secure` (an `https://` callback URL or `COOKIE_SECURE=true`) or the callback URL is loopback (`localhost`, `127.0.0.1`, `[::1]`, or a `*.localhost` name). Otherwise the backend answers `400 Command-line sign-in requires an https server`. Browser sign-in and API keys (`--api-key`) work either way; see [CLI](/developers/cli/).

## Known limitations

- Turning `Secure` on renames the session cookies, so everyone signed in is signed out once.
- Google sign-in is browser-only. The CLI signs in with GitHub or an API key.
- An account created before email verification was required can be reached only through its original provider until its owner signs in with that provider once. Until then, the other provider shows "An account already exists for that email address under the other sign-in provider."

## Related

- [Configuration](/developers/self-hosting/configuration#backend-sessions-and-cookies) for token and cookie lifetimes.
- [Deploy to production](/developers/self-hosting/deploy#run-behind-a-tls-proxy) for the rest of the proxy setup.
- [Troubleshooting](/developers/self-hosting/troubleshooting) for sign-in errors.
