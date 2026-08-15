-- 指示文を渡してから直り終わるまでを、鍵から進められるようにする。
--
-- 足すのは3つ。
--   1. 要望に「どの確認依頼(PR)で直したか」の控え
--   2. 鍵に「できること」と「会社」
--   3. 鍵がどの要望を実際に読み取ったかの表
--
-- 既存の鍵は abilities の既定値 ('["read"]') が入るので、これまでどおり読むだけになる。
-- 列を足したことで、いま出回っている鍵の力が増えることはない。

ALTER TABLE improvement_request ADD COLUMN pr_url TEXT;
ALTER TABLE improvement_request ADD COLUMN pr_number INTEGER;

ALTER TABLE improvement_access_token ADD COLUMN abilities TEXT NOT NULL DEFAULT '["read"]';
-- 単一の会社しか扱っていないので、いまは必ず NULL。
-- マルチテナントにするときに会社IDを焼き込むのはこの列1点。
ALTER TABLE improvement_access_token ADD COLUMN company_id TEXT;

CREATE TABLE IF NOT EXISTS improvement_token_claim (
  token_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  PRIMARY KEY (token_id, request_id)
);

CREATE INDEX IF NOT EXISTS improvement_token_claim_request_idx
  ON improvement_token_claim (request_id);
