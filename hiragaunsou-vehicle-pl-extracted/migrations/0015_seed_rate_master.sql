-- レートマスタの初期値投入。
--
-- 要件定義 2.2 は一般管理費を「率マスタから自動」と定めているが、rate_master に
-- 値を投入する経路が実装されておらず、実際には DEFAULT_RATE_SETTINGS の定数へ
-- 常にフォールバックしていた (設計上は可変・実装上は定数固定)。ここで正をDBに移す。
--
-- 一般管理費率 0.1748 の根拠 (2026-08-08 実測):
--   現行Excel「運送収支表 2025-2026 5月更新.xlsx」の一般管理費列は全12ヶ月とも
--   運送収入 × 17.48%。数式セルは `=M列*17.48%`、値貼り付けの月も自シートの
--   運送収入に対し 0.174800 ちょうど。ブック全体で 16.9% はどの数式・セル値にも現れない。
--   「項目説明」シートの 16.9%(3期平均) は算出"方法"の記述で、3期平均を最新期で
--   再計算した結果が 17.48%。説明シートの更新が漏れていたもので、両者は矛盾しない。
--   実データ突合でも 0.169 では101台中100台・513項目が不一致、0.1748 では34台・151項目
--   (残差は運行実績由来で率と無関係)。率由来の不一致362件が消える。
--
-- 誤りと判明した場合は該当行を DELETE するだけで DEFAULT_RATE_SETTINGS に戻る。
--
-- year_month = NULL は全期間共通値。SQLite は NULL 同士を等しいと見なさないため
-- unique index (key, year_month) が効かず、INSERT OR IGNORE では重複を防げない。
-- 再適用しても増えないよう NOT EXISTS で明示的に守る。
INSERT INTO `rate_master` (`id`, `key`, `year_month`, `value`)
SELECT 'seed_admin_fee_rate', 'admin_fee_rate', NULL, 0.1748
WHERE NOT EXISTS (
  SELECT 1 FROM `rate_master` WHERE `key` = 'admin_fee_rate' AND `year_month` IS NULL
);
--> statement-breakpoint
-- 以下3件は DEFAULT_RATE_SETTINGS / DEFAULT_DEFICIT_THRESHOLDS と同値。
-- 値を変えるためではなく「業務ルールの正は rate_master にある」を実態にするために入れる。
-- 定数にしか値が無い状態だと、現場が変えたいときに開発者を呼ぶしかない。
INSERT INTO `rate_master` (`id`, `key`, `year_month`, `value`)
SELECT 'seed_toll_discount_rate', 'toll_discount_rate', NULL, 0.356
WHERE NOT EXISTS (
  SELECT 1 FROM `rate_master` WHERE `key` = 'toll_discount_rate' AND `year_month` IS NULL
);
--> statement-breakpoint
INSERT INTO `rate_master` (`id`, `key`, `year_month`, `value`)
SELECT 'seed_bonus_annual', 'bonus_annual', NULL, 400000
WHERE NOT EXISTS (
  SELECT 1 FROM `rate_master` WHERE `key` = 'bonus_annual' AND `year_month` IS NULL
);
--> statement-breakpoint
INSERT INTO `rate_master` (`id`, `key`, `year_month`, `value`)
SELECT 'seed_deficit_idle_sales', 'deficit_idle_sales', NULL, 300000
WHERE NOT EXISTS (
  SELECT 1 FROM `rate_master` WHERE `key` = 'deficit_idle_sales' AND `year_month` IS NULL
);
--> statement-breakpoint
INSERT INTO `rate_master` (`id`, `key`, `year_month`, `value`)
SELECT 'seed_deficit_repair_spike', 'deficit_repair_spike', NULL, 300000
WHERE NOT EXISTS (
  SELECT 1 FROM `rate_master` WHERE `key` = 'deficit_repair_spike' AND `year_month` IS NULL
);
--> statement-breakpoint
-- 損益分岐km単価。既定値 170 は実態と乖離している (2026年5月の実測 costPerKm は
-- 176.9円/km、km単価170円未満は51台に対し実際の赤字は39台)。一般管理費率を
-- 0.1748 に正した上での実測値に合わせる。分岐線がずれたままではダッシュボードの
-- 「どの車両が損益分岐を下回るか」という判断そのものが歪む。
INSERT INTO `rate_master` (`id`, `key`, `year_month`, `value`)
SELECT 'seed_break_even_km_price', 'break_even_km_price', NULL, 177
WHERE NOT EXISTS (
  SELECT 1 FROM `rate_master` WHERE `key` = 'break_even_km_price' AND `year_month` IS NULL
);
