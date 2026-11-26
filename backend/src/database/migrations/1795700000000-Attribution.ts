import { MigrationInterface, QueryRunner } from "typeorm";

export class Attribution1795700000000 implements MigrationInterface {
    name = 'Attribution1795700000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contacts" ADD "first_touch" jsonb`);
        await queryRunner.query(`ALTER TABLE "contacts" ADD "last_touch" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "last_touch"`);
        await queryRunner.query(`ALTER TABLE "contacts" DROP COLUMN "first_touch"`);
    }
}
