---
name: forgechat-ai-agent-skill
description: Generate a production-ready system prompt for a ForgeChat WhatsApp AI agent (order bot, booking bot, lead-capture bot, etc.) AND, when a ForgeChat MCP connector is available, build/configure that agent directly in ForgeChat over MCP. Use this skill WHENEVER the user wants to "write a prompt for an agent", "build a WhatsApp bot prompt", "create a system prompt for a client's chatbot/order assistant/booking assistant", "create/build a ForgeChat agent via MCP", set up a ForgeChat agent, or asks for an agent prompt that uses send_media / Google Sheets / HTTP tools and a step-by-step conversation flow. First interview the user for the missing details, then assemble the prompt in the exact structure below; if an MCP connector is connected, optionally create the agent with it (Phase 4). Do NOT free-write an agent prompt without this skill — the structure (step-locked flow, tool discipline, verbatim copy, anti-hallucination guardrails) is what makes these bots reliable.
---

# ForgeChat AI Agent Prompt Builder

This skill produces the **system prompt** that drives a ForgeChat WhatsApp AI agent. The output is a single block of instructions the operator pastes into the agent node (n8n / ForgeChat). These agents run on WhatsApp, fire tools like `send_media` and a Google Sheets append, and read the customer's number from the conversation context.

The job has two phases: **interview** the operator for the inputs, then **assemble** the prompt from the template. Never skip the interview — a vague prompt produces an unreliable bot.

---

## Phase 1 — Interview

Ask for what's missing in tight batches (don't dump 20 questions at once; group them, use tappable options where it speeds things up). Re-use anything already stated in the conversation. Confirm the catalog and the exact step copy before assembling.

Collect these inputs:

**A. Identity & voice**
- Business name + what it is — e.g. "The Copper Spoon (Kitchen & Café), a restaurant".
- Assistant role label — e.g. "order assistant", "booking assistant".
- Tone — default: friendly, short replies, light emoji.
- Language — default: reply in the customer's language.
- Pacing — default: one step per reply.

**B. Catalog / offerings**
- Currency — default INR (₹).
- The full list, grouped into sections, each item with a price. For order bots this is a menu/product list; for booking bots it's services + prices/durations; for lead bots it may be plans/packages.

**C. Media assets (ForgeChat `send_media` groups)**
- Which pre-configured media groups exist and their `group_index` (integer). Typical: `0` = menu / catalog image, `1` = payment link. There can be more (e.g. `2` = location, `3` = brochure).
- For each: in which step it is sent, and how many times (almost always **exactly once**).

**D. Data logging (Google Sheets append — optional but common)**
- Is the order/booking saved to a sheet? If yes, get the **exact column order** as a list. The bot must append in that order, no rearranging.
- Which step it appends in (usually the confirm step) and how many times (**exactly once** — idempotency matters).

**E. Conversation flow**
- Default is the 5-step transactional flow below. Confirm it fits or capture the client's variant (extra steps, different first question, table booking vs delivery, etc.).
- Confirmation keyword — default `CONFIRM`.
- Order/booking ID format — e.g. `FM<NNN>` (letters `FM` + three digits).
- Where the customer identifier comes from — default: the customer's WhatsApp number from the conversation context. The bot must **never ask** for it.

**F. Guardrails (defaults — confirm)**
- Only items/prices from the catalog; never invent.
- Match the customer's wording to the closest catalog item (e.g. "biryani" → "Vegetable Biryani").
- Send each media group exactly once, in its assigned step.
- Append to the sheet exactly once.
- Do NOT call any tool in the summary/quote step.

After gathering, **draft the exact wording for each step's reply** in the business's voice and show the operator for sign-off before producing the final prompt. Verbatim copy (in quotes) is what stops the live agent from paraphrasing inconsistently.

---

## Phase 2 — Design principles to bake in

Every generated prompt must enforce these. They are the reason these bots stay reliable:

1. **Step-locked flow.** Each step has one clear *trigger* (what the customer just did) and one *action*. State "one step per reply" so the agent never runs ahead.
2. **Verbatim copy.** Write each step's reply out in full, inside quotes, with `<placeholders>` for dynamic values. The agent should send these near-exactly, not improvise.
3. **Tool discipline.** Spell out the `group_index` → asset mapping, when each tool fires, and "exactly once". Explicitly state where tools must **not** fire (the quote/summary step is a common over-call trap).
4. **Deterministic math.** For orders: compute `qty × price` per line and a grand total; show line items then total.
5. **Closest-match mapping.** Tell the agent to map loose customer wording to the nearest catalog item, and to flag anything not on the list as unavailable (then re-show the sections).
6. **Anti-hallucination.** Only catalog items and prices; never invent an item, price, or detail.
7. **Context-derived identity.** Pull the WhatsApp number from conversation context; never ask the customer for it.
8. **Idempotency.** Append to the sheet exactly once, in its assigned step; never re-append on later turns.

---

## Phase 3 — Output template

Fill this in and deliver it as the final prompt. Keep the structure and the section headers; swap the bracketed parts. Omit sections that don't apply (e.g. no sheet → drop the append clause). Present the finished prompt in a single fenced code block so it's copy-paste ready, and offer to save it as a `.txt`/`.md` file.

```
You are the <ROLE> for <BUSINESS NAME + WHAT IT IS>. <TONE LINE, e.g. Friendly, short replies, light emoji.> Reply in the customer's language. One step per reply.

MENU (<CURRENCY>):
<Section>: <Item> <price>, <Item> <price>, ...
<Section>: <Item> <price>, ...
<Section>: <Item> <price>, ...

TOOL RULES (critical):
- send_media group_index <N> = <asset, e.g. the menu image>. group_index <N> = <asset, e.g. the payment link>.
- Send <asset 0> (<index>) exactly once, in step <X>. Send <asset 1> (<index>) exactly once, in step <Y>.
- Never type the <catalog/menu> as text; it only goes out as the image.

STEPS:
1) First message -> greet and ask ONLY their name:
"<exact greeting + ask for name>"
2) As soon as they give their name -> call send_media group_index <0>, then reply:
"<exact reply that welcomes them by <Name>, points to the menu, and asks what + how many they want, with an Example line>"
3) When they order -> match each requested item to the closest menu item, compute qty x price per item and the grand total. In this step DO NOT call any tool and DO NOT send media. Only reply:
"<exact order-summary format with line items '• <qty> x <Item> – <cur><price> = <cur><lineTotal>', a 'Total payable: <cur><total>' line, and a 'reply *<CONFIRM KEYWORD>* to pay, or tell me what to change' line>"
If an item is not on the menu, say it is unavailable and list the menu sections.
4) When they confirm -> do <ALL of these> this turn:
   a) call send_media group_index <1> (the payment link),
   b) call the Google Sheets append tool ONCE to save the order, with values in THIS column order:
      [<col 1>, <col 2>, <col 3>, ...]
   c) reply: "<short payment-handoff line, e.g. Order for <Name> – <cur><total>/- 👇>"
5) After they say they paid (paid/done, or any message after the payment link) -> reply (do NOT append again):
"<exact success message: thank <Name>, confirm payment of <cur><total>, give Order ID <ID FORMAT>, confirm order placed>"
(<ID FORMAT explanation, e.g. FM<NNN> = the letters FM then three digits, e.g. FM042.>)

Only items and prices from the menu above; never invent. Match the customer's wording to the closest menu item (e.g. "<loose term>" = <Catalog Item>). Use the customer's WhatsApp number from the Conversation context for the sheet; never ask for it. Append to the sheet exactly once, in step <4>.
```

**Adapting for non-order flows**

The skeleton holds for other transactional agents — swap the nouns and the step actions:
- **Booking bot:** catalog = services + durations; step 2 sends the service list, asks date/time; step 3 confirms the slot; step 4 sends payment + appends the booking; step 5 returns a booking ID.
- **Lead-capture bot:** no payment; steps collect name → need → budget → contact preference, then append the lead row and send a brochure/media.

Keep all eight design principles regardless of flow.

---

## Phase 4 — Build the agent in ForgeChat over MCP (optional)

Phases 1–3 produce the **system prompt**. If a ForgeChat **MCP connector** is connected, you can also **create and configure the agent directly in ForgeChat** instead of pasting the prompt by hand — Claude drives the build through the MCP tools.

**Connect once:** in ForgeChat → **Admin Settings → MCP Tools**, turn on the master switch + capabilities, **Generate key**, then add the remote connector URL `https://<your-forgechat-domain>/api/mcp/http/<key>` in Claude (Settings → Connectors → Add custom connector). The connector is per-deployment — it manages that instance's data only.

**Golden rule (same as the prompt phase): never invent ids.** Fetch the real options with the discovery tools, let the user choose, summarize, and get an explicit confirmation before `create_agent`.

Build flow:
1. Confirm the final system prompt from Phase 3 (this becomes the agent's `systemPrompt`).
2. `list_wa_accounts` → ask which WhatsApp number it runs on.
3. `list_models` → ask which provider + model; pass `aiModelId` + `llmModel`. An ACTIVE agent needs both; otherwise save `status:"draft"`.
4. Trigger: `"any"` (every message) or `"keyword"` (ask keyword, match type exact/contains/starts, case sensitivity, session minutes — default 30).
5. Inbound understanding: set `transcribeAudio:true` to transcribe voice notes (needs an OpenAI key), `acceptImages:true` to let it see images (pick a vision-capable model, e.g. GPT-4o / Claude).
6. Tools:
   - **Google Sheets** (per connected Google account): `list_google_accounts` → `search_spreadsheets` (with that `googleAccountId`) → `list_sheet_tabs` → ask which ops (read/append/update), then `add_google_sheets_tool` (`googleAccountId` + spreadsheet + tab + ops).
   - **HTTP request** (call an external API / device / webhook): `add_http_tool` with method + URL (use `{name}` for path params) + static auth headers + the params the AI fills (each: name, location path/query/body/header, type, description, required).
7. Media groups (optional): for each, a "when to send" **description** + media (`list_media`) and/or an approved template (`list_templates` → `get_template` to confirm content before using its id).
8. Summarize the full config, get a "yes", then `create_agent`; attach any tools; report the new agent id and offer to activate it (Go Live).

**MCP tools available** — discovery: `list_wa_accounts`, `list_models`, `list_google_accounts`, `search_spreadsheets`, `list_sheet_tabs`, `list_media`, `list_templates`, `get_template`, `list_agents`, `get_agent`. Mutations: `create_agent`, `update_agent`, `add_google_sheets_tool`, `add_http_tool`, `add_tool`, `update_tool`, `delete_tool`, `delete_agent`. The master switch + per-capability toggles in Admin Settings → MCP Tools gate what's allowed (a disabled capability returns 403); always confirm destructive actions first.

**Constraints to respect** (the server enforces them too): OpenAI / Anthropic providers only; one active agent per WhatsApp number; a keyword-triggered active agent needs a keyword; context window 1–100 messages; max tool iterations 1–20; trigger session 1–1440 minutes; `acceptImages` requires a vision-capable model.

---

## Final checklist before delivering

- [ ] Role, business, tone, language, and "one step per reply" all in the opening line.
- [ ] Every catalog item has a price; currency stated; nothing outside the list.
- [ ] Each `send_media group_index` mapped, assigned to a step, marked "exactly once".
- [ ] Sheet column order copied **exactly** as the operator gave it; append marked once, in one step.
- [ ] Quote/summary step explicitly says **no tools**.
- [ ] Confirmation keyword and ID format match what the operator asked for.
- [ ] WhatsApp number sourced from context, never requested.
- [ ] Each step's reply written out verbatim in quotes with `<placeholders>` for dynamic values.
- [ ] Delivered in one fenced code block; offered as a downloadable file.
