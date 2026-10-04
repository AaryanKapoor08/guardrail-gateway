-- Append-only audit, enforced by the database (PRODUCT_VISION §14.3, verbatim).
-- Blocks all UPDATEs; allows DELETE only inside the account-deletion transaction,
-- which runs: SET LOCAL app.deleting_user = '<user uuid>';
CREATE FUNCTION audit_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'audit_events is append-only'; END IF;
  IF TG_OP = 'DELETE' AND current_setting('app.deleting_user', true) IS DISTINCT FROM OLD.user_id::text
    THEN RAISE EXCEPTION 'audit_events rows can only be deleted with their account'; END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_guard BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_guard();
