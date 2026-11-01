# Microsoft mail setup

No deployment is performed by this change. Before Microsoft mail can be offered, an owner must:

1. In Microsoft Entra Admin Center, create an **App registration**.
2. Choose **Accounts in any organizational directory and personal Microsoft accounts** (multitenant).
3. Add a Web redirect URI matching `MICROSOFT_REDIRECT_URI` and the backend callback `/v1/connections/mail/microsoft/oauth/callback`.
4. Add delegated Microsoft Graph permissions `openid`, `profile`, `email`, `offline_access`, and `Mail.Send`. Do not add application mail permissions.
5. Create a client secret, store it only in the server's secret manager, and configure:

```text
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_REDIRECT_URI=
```

If these values are absent, the API returns a configuration-unavailable response and the app displays a non-technical availability message. Never commit the values.

SMTP connections support only port 465 with TLS or port 587 with STARTTLS. Use a provider-issued app password rather than the mailbox's normal password whenever the provider supports it.
