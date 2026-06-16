#!/usr/bin/env python3
"""IA360 full-funnel dry-run classifier.

Read-only diagnostic: pulls existing Alek WhatsApp/email events and classifies
what n8n/pipeline agents SHOULD do. It does not write to any database, send
messages, create contacts, or update pipelines.
"""
import json
import re
import subprocess
from dataclasses import dataclass, asdict
from typing import List

CANONICAL = {
    "forgechat_contact_id": 2,
    "whatsapp_contact_number": "5213322638033",
    "whatsapp_wa_number": "5213321594582",
    "espocrm_contact_id": "6a1e395e3ea030531",
    "email": "Ocompudoc@gmail.com",
}

NEGATIVE_PATTERNS = [
    r"pendej", r"basta de pruebas", r"pruebas sueltas", r"no me sirve",
    r"no.*objetivo", r"cagadero", r"deja de", r"mal plantead",
]
HIGH_INTENT_PATTERNS = [
    r"ventas", r"prospecci[oó]n", r"empresarios", r"alto nivel", r"contratar",
    r"implementar", r"aplicar", r"costo", r"propuesta", r"agenda", r"reuni[oó]n",
]
PAIN_PATTERNS = {
    "ventas_prospeccion_alto_nivel": [r"ventas", r"prospecci[oó]n", r"prospectos", r"empresarios", r"alto nivel"],
    "whatsapp_crm_pipeline": [r"whatsapp", r"crm", r"pipeline", r"embudo"],
    "erp_bi_operativo": [r"erp", r"bi", r"reportes", r"datapower", r"dashboards"],
    "agentic_workflows": [r"agente", r"agentes", r"n8n", r"automatiz", r"clasific"],
}

@dataclass
class Classification:
    source: str
    event_id: str
    subject_or_type: str
    text_excerpt: str
    event_type: str
    intent: str
    pain_tags: List[str]
    temperature: str
    forgechat_stage: str
    espo_stage: str
    should_create_task: bool
    should_create_or_update_opportunity: bool
    should_send_auto_reply: bool
    next_action: str
    reason: str


def sh(cmd: str) -> str:
    return subprocess.check_output(cmd, shell=True, text=True, stderr=subprocess.DEVNULL)


def sh_stdin(cmd: str, data: str) -> str:
    return subprocess.run(
        cmd,
        input=data,
        shell=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=True,
    ).stdout


def norm(s: str) -> str:
    return (s or "").lower()


def has_any(text: str, patterns: List[str]) -> bool:
    t = norm(text)
    return any(re.search(p, t) for p in patterns)


def detect_pains(text: str) -> List[str]:
    t = norm(text)
    tags = []
    for tag, patterns in PAIN_PATTERNS.items():
        if any(re.search(p, t) for p in patterns):
            tags.append(tag)
    return tags


def classify(source: str, event_id: str, subject_or_type: str, text: str) -> Classification:
    excerpt = " ".join((text or "").split())[:220]
    pains = detect_pains(text)
    if has_any(text, NEGATIVE_PATTERNS):
        return Classification(
            source, event_id, subject_or_type, excerpt,
            "negative_feedback", "human_review", pains or ["test_process_failure"], "high",
            "Requiere Alek", "Qualification", True, False, False,
            "pause_automation_and_create_human_review_task",
            "Frustrated/negative feedback must stop automated branch and trigger human review.",
        )
    if has_any(text, HIGH_INTENT_PATTERNS):
        return Classification(
            source, event_id, subject_or_type, excerpt,
            "reply_high_intent", "qualified_interest", pains, "hot" if pains else "warm",
            "Requiere Alek", "Qualification", True, True, False,
            "create_or_update_opportunity_and_human_followup_task",
            "Reply contains business objective/interest; should not stay archived/passive.",
        )
    return Classification(
        source, event_id, subject_or_type, excerpt,
        "reply_unclassified", "unknown", pains, "cold",
        "Nutrición", "Prospecting", False, False, False,
        "log_note_only_or_nurture", "No high-intent or negative signal detected.",
    )


def get_latest_email_reply() -> tuple:
    sql = """
select id, name, coalesce(body_plain, body, '')
from email
where from_string like '%Ocompudoc%'
  and parent_id='6a1e395e3ea030531'
order by created_at desc
limit 1;
""".strip()
    cmd = "docker exec -i espocrm-db sh -lc 'mariadb -uroot -p\"$MARIADB_ROOT_PASSWORD\" \"$MARIADB_DATABASE\" -N'"
    out = sh_stdin(cmd, sql).strip()
    if not out:
        return None
    parts = out.split("\t", 2)
    return parts[0], parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""


def get_latest_whatsapp_incoming() -> tuple:
    sql = """
select id::text, message_type, coalesce(message_body,'')
from coexistence.chat_history
where contact_number='5213322638033' and direction='incoming'
order by timestamp desc
limit 1;
""".strip()
    cmd = "docker exec -i forgecrm-db psql -U postgres -d postgres -Atq"
    out = sh_stdin(cmd, sql).strip()
    if not out:
        return None
    parts = out.split("|", 2)
    return parts[0], parts[1] if len(parts) > 1 else "", parts[2] if len(parts) > 2 else ""


def main():
    events = []
    email = get_latest_email_reply()
    if email:
        events.append(classify("email", email[0], email[1], email[2]))
    wa = get_latest_whatsapp_incoming()
    if wa:
        events.append(classify("whatsapp", wa[0], wa[1], wa[2]))
    print(json.dumps({
        "mode": "dry_run_read_only",
        "canonical": CANONICAL,
        "events_classified": [asdict(e) for e in events],
    }, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
