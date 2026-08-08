-- トラクタ(けん引車)とトレーラ(被けん引車)の統合。
--
-- 車検証上は別車両なので保険・税・リース料はトレーラにも付くが、運転者も運賃も
-- トラクタ側にしか付かない。現行Excelの最終成果物は両者を1行にまとめて
-- 「129/1113」のように並べた車番で出しており、106行が101行になる差はここ。
--
-- 対応表は元データのどのCSVにも無く、Excelの行ラベルだけが持っている。
-- したがって人が車両マスタに登録する以外に復元手段が無いため、マスタ側に列を置く。
ALTER TABLE `vehicle_master` ADD `towed_by_vehicle_no` text REFERENCES `vehicle_master`(`vehicle_no`);
--> statement-breakpoint
CREATE INDEX `vehicle_master_towed_by_idx` ON `vehicle_master` (`towed_by_vehicle_no`);
--> statement-breakpoint
-- 統合結果の行が「どのトレーラを吸収したか」。車番そのものはトラクタのままにする
-- (運行実績・給与・手入力・上書きが全てトラクタの車番でキーされているため、
--  合成キーにすると全ての紐づけが切れる)。表示ラベルはこの列から組み立てる。
ALTER TABLE `vehicle_pl` ADD `towed_vehicle_nos` text DEFAULT '' NOT NULL;
