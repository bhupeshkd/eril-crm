import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { EntityManager, ILike, Repository } from 'typeorm';
import { Coupon } from '../database/entities/payment.entity';
import { couponDiscount, couponProblem } from './billing-math';

export class CreateCouponDto {
  @Matches(/^[A-Za-z0-9_-]{3,40}$/, { message: 'Code must be 3-40 letters, numbers, dashes or underscores' }) code: string;
  @IsIn(['percent', 'fixed']) type: 'percent' | 'fixed';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsIn(['once', 'forever', 'repeating']) duration?: 'once' | 'forever' | 'repeating';
  @ValidateIf((o) => o.duration === 'repeating') @IsInt() @Min(1) @Max(120) durationCycles?: number;
  @IsOptional() @IsIn(['all', 'invoices', 'subscriptions']) appliesTo?: 'all' | 'invoices' | 'subscriptions';
  @IsOptional() @IsInt() @Min(1) maxRedemptions?: number | null;
  @IsOptional() @ValidateIf((o) => o.expiresAt !== null) @IsDateString() expiresAt?: string | null;
}
export class UpdateCouponDto {
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @ValidateIf((o) => o.expiresAt !== null) @IsDateString() expiresAt?: string | null;
  @IsOptional() @ValidateIf((o) => o.maxRedemptions !== null) @IsInt() @Min(1) maxRedemptions?: number | null;
}

@Injectable()
export class CouponsService {
  constructor(@InjectRepository(Coupon) private readonly coupons: Repository<Coupon>) {}

  list(workspaceId: string) {
    return this.coupons.find({ where: { workspaceId }, order: { createdAt: 'DESC' } });
  }

  async create(workspaceId: string, dto: CreateCouponDto) {
    if (dto.type === 'percent' && dto.amount > 100) throw new BadRequestException('A percentage discount cannot exceed 100%');
    if (dto.type === 'fixed' && !dto.currency) throw new BadRequestException('Fixed-amount coupons need a currency');
    const code = dto.code.toUpperCase();
    if (await this.coupons.exist({ where: { workspaceId, code } })) throw new ConflictException(`Coupon ${code} already exists`);
    return this.coupons.save(
      this.coupons.create({
        workspaceId,
        code,
        type: dto.type,
        amount: dto.amount,
        currency: dto.type === 'fixed' ? dto.currency!.toUpperCase() : null,
        duration: dto.duration ?? 'once',
        durationCycles: dto.duration === 'repeating' ? dto.durationCycles ?? 1 : null,
        appliesTo: dto.appliesTo ?? 'all',
        maxRedemptions: dto.maxRedemptions ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      }),
    );
  }

  async update(workspaceId: string, id: string, dto: UpdateCouponDto) {
    const c = await this.coupons.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Coupon not found');
    if (dto.isActive !== undefined) c.isActive = dto.isActive;
    if (dto.expiresAt !== undefined) c.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.maxRedemptions !== undefined) c.maxRedemptions = dto.maxRedemptions;
    return this.coupons.save(c);
  }

  async remove(workspaceId: string, id: string) {
    const res = await this.coupons.softDelete({ id, workspaceId });
    if (!res.affected) throw new NotFoundException('Coupon not found');
    return { id };
  }

  async find(workspaceId: string, code: string) {
    const c = await this.coupons.findOne({ where: { workspaceId, code: ILike(code.trim()) } });
    if (!c) throw new NotFoundException(`Coupon "${code.trim().toUpperCase()}" was not found`);
    return c;
  }

  /** Preview a coupon without using it. */
  async preview(workspaceId: string, code: string, use: 'invoices' | 'subscriptions', currency: string, subtotal: number) {
    const c = await this.find(workspaceId, code);
    const problem = couponProblem(c, use, currency);
    if (problem) throw new BadRequestException(problem);
    return { code: c.code, type: c.type, amount: c.amount, duration: c.duration, durationCycles: c.durationCycles, discount: couponDiscount(c, subtotal) };
  }

  /**
   * Validates and consumes one redemption atomically (the UPDATE re-checks the limit,
   * so two simultaneous checkouts cannot both take the last use).
   */
  async redeem(workspaceId: string, code: string, use: 'invoices' | 'subscriptions', currency: string, tx?: EntityManager) {
    const repo = tx ? tx.getRepository(Coupon) : this.coupons;
    const c = await repo.findOne({ where: { workspaceId, code: ILike(code.trim()) } });
    if (!c) throw new NotFoundException(`Coupon "${code.trim().toUpperCase()}" was not found`);
    const problem = couponProblem(c, use, currency);
    if (problem) throw new BadRequestException(problem);
    const res = await repo
      .createQueryBuilder()
      .update(Coupon)
      .set({ redemptions: () => 'redemptions + 1' })
      .where('id = :id AND is_active = true AND (max_redemptions IS NULL OR redemptions < max_redemptions)', { id: c.id })
      .execute();
    if (!res.affected) throw new BadRequestException('This coupon has reached its usage limit');
    return c;
  }

  /** Recompute a discount for an already-applied coupon (no new redemption). */
  async discountFor(workspaceId: string, code: string, subtotal: number) {
    const c = await this.coupons.findOne({ where: { workspaceId, code: ILike(code) }, withDeleted: true });
    return c ? couponDiscount(c, subtotal) : 0;
  }

  async getById(id: string) {
    return this.coupons.findOne({ where: { id }, withDeleted: true });
  }
}
