-- 035_broadcast_template_fk_set_null.sql
-- Allow deleting a message template that was used by past broadcasts.
--
-- Problem: broadcasts.template_id → message_templates(id) had ON DELETE NO ACTION
-- (RESTRICT), so deleting any template referenced by a broadcast failed with a
-- foreign-key violation ("Failed to delete template").
--
-- Fix: ON DELETE SET NULL. Deleting a template unlinks it from historical
-- broadcasts (their logs + the per-message template snapshot in chat_history
-- remain intact) instead of blocking the delete.

ALTER TABLE coexistence.broadcasts
  DROP CONSTRAINT IF EXISTS broadcasts_template_id_fkey;

ALTER TABLE coexistence.broadcasts
  ADD CONSTRAINT broadcasts_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES coexistence.message_templates(id)
  ON DELETE SET NULL;
