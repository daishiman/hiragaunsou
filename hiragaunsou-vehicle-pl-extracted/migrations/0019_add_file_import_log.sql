-- ファイル取込の記録。「同じファイルをもう一度取り込もうとしている」を検知するために使う。
--
-- これまで取込の記録は月次帳票(csv_import_batch)にしか無く、マスタ取込は何も残らなかった。
-- また記録にファイル名しか無いため、名前を変えた同じファイルを二重に取り込んでも気づけなかった。
-- 画面を問わず「中身の指紋」を残し、取込前の照合に使う。
CREATE TABLE IF NOT EXISTS file_import_log (
  id TEXT PRIMARY KEY,
  -- import / vehicle_master / driver_master
  screen TEXT NOT NULL,
  source_type TEXT NOT NULL,
  -- マスタ取込のように月に紐づかないものは NULL
  year_month TEXT,
  -- 参考情報。判定には使わない(社内のファイル名は毎月変わる)
  file_name TEXT NOT NULL,
  -- 中身のSHA-256。同一ファイルの判定はこれだけで行う
  content_hash TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
  -- 利用者を削除しても取込の記録は残す(誰が入れたかは imported_by_name に残る)。
  -- 記録が消えると「取り込み済み」の照合が効かなくなり、二重取込を見逃す。
  imported_by TEXT REFERENCES user(id) ON DELETE SET NULL,
  imported_by_name TEXT NOT NULL DEFAULT ''
);

-- 重複判定は「中身が同じか」で引く。
CREATE INDEX IF NOT EXISTS file_import_log_hash_idx ON file_import_log (content_hash);
-- 取込データ管理での一覧表示(画面別・新しい順)。
CREATE INDEX IF NOT EXISTS file_import_log_screen_idx ON file_import_log (screen, imported_at);
-- 同じ名前で中身が変わったかの照合。
CREATE INDEX IF NOT EXISTS file_import_log_name_idx ON file_import_log (file_name);
