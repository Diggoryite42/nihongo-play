CREATE SEQUENCE IF NOT EXISTS kana_catalog_id_seq;
ALTER SEQUENCE kana_catalog_id_seq OWNED BY kana_catalog.id;
ALTER TABLE kana_catalog ALTER COLUMN id SET DEFAULT nextval('kana_catalog_id_seq');

SELECT setval(
  'kana_catalog_id_seq',
  GREATEST(COALESCE((SELECT MAX(id) FROM kana_catalog), 0), 1),
  EXISTS (SELECT 1 FROM kana_catalog)
);
