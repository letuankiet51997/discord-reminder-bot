# AGENTS.md — discord-event-bot

Instructions for an AI that updates the reminder list of this bot.

## What the bot does

GitHub Actions runs `src/send.js` every 5 minutes. It posts the reminders that
are due from `events.json` to one Discord channel through a webhook. Editing and
committing `events.json` is the only way to add, change or remove a reminder.
Reminders may arrive 5–15 minutes late; that is accepted.

## Your task

The user sends a list of reminders, in any language or format. Turn it into
`events.json`:

1. Read `events.schema.json` (exact format) and `events.example.json` (every case).
2. Write one object per reminder in `events.json`, using only the fields below.
   Keep the `"$schema": "./events.schema.json"` line.
3. Replace the whole list when the user sends a full list; add, change or remove
   only the named entries when the user asks for a change.
4. Run `npm test` and confirm it passes. Show the user the final list.

## Fields

| Field | Required | Rule |
|---|---|---|
| `title` | yes | Short headline. Keep the user's wording. |
| `time` | yes | Vietnam time, 24-hour clock. See the table below. |
| `repeat` | no | Only `daily`, `weekly` or `monthly`. Default `daily`. |
| `role` | no | A role **alias** from the `DISCORD_ROLES` secret (e.g. `dev`), `everyone` or `here`. Omit for no ping. |
| `message` | no | Extra text under the title. |

| `repeat` | `time` format | Meaning |
|---|---|---|
| `daily` | `HH:MM` | Every day at that time. |
| `weekly` | `YYYY-MM-DD HH:MM` | Every week on the weekday of that date. |
| `monthly` | `YYYY-MM-DD HH:MM` | Every month on that day of the month (short months use their last day). |

## Converting what the user says

- "mỗi ngày 8h" → `"time": "08:00", "repeat": "daily"`.
- "thứ 4 hằng tuần 20h" → `weekly`, with `time` set to the next Wednesday,
  e.g. `"2026-11-11 20:00"`. Compute the date from today; check the weekday.
- "ngày 15 hằng tháng 10h" → `monthly`, `time` set to the next 15th, e.g. `"2026-11-15 10:00"`.
- "tag mọi người" / "@everyone" → `"role": "everyone"`. "@here" → `"here"`.
- "tag role Dev" → `"role": "dev"`. Role ids live only in the `DISCORD_ROLES`
  secret (`alias=id`, one per line), which you cannot see. If the alias may be
  new, tell the user to add `dev=<role id>` to `DISCORD_ROLES` (Server Settings →
  Roles → right-click → Copy Role ID). Use lowercase letters, digits, `-`, `_`.

## Duplicates are errors

- Two events with the same `title`, `time` and `repeat`.
- In `DISCORD_ROLES`: the same alias twice, or the same id under two aliases.

Before writing, check the list has no duplicate event. When the user gives a new
role, check it does not reuse an alias or id they already listed.
- "8h tối", "8pm" → `20:00`. "8h sáng" → `08:00`.

## Do not

- Do not use other `repeat` values (`once`, `weekdays`, `hằng ngày`, …). If the
  user asks for one-time or weekday-only reminders, say the bot does not support
  it; for weekdays only, offer five `weekly` entries (Monday to Friday).
- Do not add fields that are not in `events.schema.json`.
- Never put a role id in `events.json` or any other file in the repo.
- Do not edit `state.json`, the workflow or the code in `src/`.
- Never write the webhook URL into any file. It lives only in the GitHub secret
  `DISCORD_WEBHOOK_URL`; role ids live only in `DISCORD_ROLES`.
