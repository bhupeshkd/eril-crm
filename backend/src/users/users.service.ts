import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  async findById(id: string) {
    const u = await this.users.findOne({ where: { id } });
    if (!u) return null;
    const { passwordHash, ...safe } = u as any;
    return safe;
  }

  async list() {
    return this.users
      .createQueryBuilder('u')
      .select(['u.id AS "id"', 'u.email AS "email"', 'u.name AS "name"', 'u.role AS "role"', 'u.email_verified AS "emailVerified"'])
      .getRawMany();
  }
}
