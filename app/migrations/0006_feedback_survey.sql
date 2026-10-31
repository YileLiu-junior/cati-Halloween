-- 生成后问卷扩展：三档满意度、相似度、不满意原因、价格区间与历史付费。
-- 旧的 satisfied / price_fen / skipped 保留，供旧客户端和已有记录继续读取。
ALTER TABLE free_feedback ADD COLUMN satisfaction INTEGER CHECK (satisfaction IS NULL OR satisfaction IN (1, 2, 3));
ALTER TABLE free_feedback ADD COLUMN similarity INTEGER CHECK (similarity IS NULL OR similarity IN (1, 2, 3));
ALTER TABLE free_feedback ADD COLUMN issue TEXT;
ALTER TABLE free_feedback ADD COLUMN price_band TEXT;
ALTER TABLE free_feedback ADD COLUMN spend_history INTEGER CHECK (spend_history IS NULL OR spend_history IN (1, 2, 3));
