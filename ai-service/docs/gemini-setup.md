# Gemini provider setup

The AI service is configured for Gemini and the implementation is complete, but
**live generation is currently blocked by a Google Cloud project setting that
only the account owner can change.**

## Current status

The configured `GEMINI_API_KEY` is a valid credential — Google identifies its
project — but the Gemini API is not enabled on that project:

```
403 PERMISSION_DENIED  SERVICE_DISABLED
generativelanguage.googleapis.com has not been used in project 914128557862
before or it is disabled.
```

Every request fails the same way, so this is not intermittent and not a code
problem. The service handles it correctly: `503 generation_failed` with a safe
message, and retrieval/search/JD-mapping keep working.

## The one action required

Enable the **Gemini API** (`generativelanguage.googleapis.com`) on project
`914128557862`:

<https://console.developers.google.com/apis/api/generativelanguage.googleapis.com/overview?project=914128557862>

Then wait a few minutes for propagation.

Alternatively, issue a key from [Google AI Studio](https://aistudio.google.com/apikey)
under a project that already has the API enabled, and replace `GEMINI_API_KEY`
in `ai-service/.env`.

## Verifying afterwards

```bash
cd ai-service
.venv/bin/python -m pytest -m live
```

The live suite **fails loudly** if the provider is unreachable — it does not
skip when a key is present, so a green run means real calls succeeded. It
covers: grounded answer, insufficient evidence, citation validity, all four
locales, candidate summary, interview questions, and adversarial prompts.

## After live verification passes

Per the migration plan, remove `GEMINI_API_KEY` from `backend/.env`. The
backend contains **no** Gemini references (verified by grep), so it is only a
leftover copy — but it should not be deleted until Gemini is proven working
from the AI service, in case the value needs to be re-read.

The final owner of the secret is `ai-service/.env`.
