import { MigrationInterface, QueryRunner } from "typeorm";

export class AppDomains1795710000000 implements MigrationInterface {
    name = 'AppDomains1795710000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "custom_domains" ADD "kind" character varying(10) NOT NULL DEFAULT 'site'`);
        await queryRunner.query(`ALTER TABLE "custom_domains" ADD "organization_id" uuid`);
        await queryRunner.query(`ALTER TABLE "custom_domains" ALTER COLUMN "site_id" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "custom_domains" ALTER COLUMN "workspace_id" DROP NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_custom_domains_org" ON "custom_domains" ("organization_id") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_custom_domains_org"`);
        await queryRunner.query(`DELETE FROM "custom_domains" WHERE "kind" = 'app'`);
        await queryRunner.query(`ALTER TABLE "custom_domains" ALTER COLUMN "site_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "custom_domains" ALTER COLUMN "workspace_id" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "custom_domains" DROP COLUMN "organization_id"`);
        await queryRunner.query(`ALTER TABLE "custom_domains" DROP COLUMN "kind"`);
    }
}
