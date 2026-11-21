import { MigrationInterface, QueryRunner } from "typeorm";

export class Branding1795150000000 implements MigrationInterface {
    name = 'Branding1795150000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" ADD "branding" jsonb NOT NULL DEFAULT '{}'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "organizations" DROP COLUMN "branding"`);
    }
}
