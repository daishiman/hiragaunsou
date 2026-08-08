-- 指摘に対する人の判断を「問題なし」だけでなく「あとで見る(後回し)」も残せるようにする。
--
-- これまで後回しは画面の中だけに持っていたので、閉じると消えていた。
-- 保管場所を増やさず、既にある印のテーブルに判断の種類を1列足す形にする。
-- 既存の行はすべて「問題なし」の判断なので既定値を 'ok' にする。
ALTER TABLE pl_issue_ack ADD COLUMN status TEXT NOT NULL DEFAULT 'ok';

-- 判断したときの値。翌月に同じ指摘が出たとき「先月もOKにした」と伝えるかどうかの判定に使う。
-- 値が大きく変わっていたら引き継がず、もう一度見てもらう。
ALTER TABLE pl_issue_ack ADD COLUMN value_at_ack REAL;

-- 「後回しだけ」「問題なしだけ」を月内で引く操作が増えるため、年月と判断の種類で引けるようにする。
CREATE INDEX IF NOT EXISTS pl_issue_ack_status_idx ON pl_issue_ack (year_month, status);
