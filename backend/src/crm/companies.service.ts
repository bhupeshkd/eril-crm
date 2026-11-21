import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Company } from '../database/entities/company.entity';
import { CreateCompanyDto, UpdateCompanyDto } from './dto';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
  ) {}

  async list(workspaceId: string, search?: string) {
    const qb = this.companies
      .createQueryBuilder('co')
      .loadRelationCountAndMap('co.contactCount', 'co.contacts')
      .where('co.workspace_id = :workspaceId', { workspaceId })
      .orderBy('co.name', 'ASC');
    if (search?.trim()) qb.andWhere('co.name ILIKE :t', { t: `%${search.trim()}%` });
    return qb.getMany();
  }

  async get(workspaceId: string, id: string) {
    const c = await this.companies.findOne({
      where: { id, workspaceId },
      relations: { contacts: true },
    });
    if (!c) throw new NotFoundException('Company not found');
    return c;
  }

  create(workspaceId: string, dto: CreateCompanyDto) {
    return this.companies.save(this.companies.create({ ...dto, workspaceId }));
  }

  async update(workspaceId: string, id: string, dto: UpdateCompanyDto) {
    const c = await this.companies.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Company not found');
    Object.assign(c, dto);
    return this.companies.save(c);
  }

  async remove(workspaceId: string, id: string) {
    const c = await this.companies.findOne({ where: { id, workspaceId } });
    if (!c) throw new NotFoundException('Company not found');
    await this.companies.softRemove(c);
    return { id };
  }

  findByName(workspaceId: string, name: string) {
    return this.companies.findOne({ where: { workspaceId, name: ILike(name) } });
  }
}
