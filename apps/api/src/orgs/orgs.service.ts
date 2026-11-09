import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Member, MembershipRole } from '@core-studio/contracts';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { AuditService } from '../audit/audit.service.js';
import type { AuthContext } from '../auth/auth-context.js';
import { canAssignRole } from '../auth/permissions.js';
import { DATABASE } from '../db/database.module.js';
import { type Database, withDbContext } from '../db/database.js';
import { organizationMemberships, organizations, users } from '../db/schema.js';

@Injectable()
export class OrgsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  private ctx(auth: AuthContext, organizationId: string) {
    return { organizationId, userId: auth.userId, platformAdmin: auth.platformAdmin };
  }

  async create(
    auth: AuthContext,
    name: string,
    correlationId: string,
  ): Promise<{ id: string; name: string }> {
    const id = crypto.randomUUID();
    return withDbContext(this.db, this.ctx(auth, id), async (tx) => {
      await tx.insert(organizations).values({ id, name });
      await tx.insert(organizationMemberships).values({
        organizationId: id,
        userId: auth.userId,
        role: 'org_owner',
        createdBy: auth.userId,
      });
      await this.audit.record(tx, {
        organizationId: id,
        actorId: auth.userId,
        action: 'org.created',
        targetType: 'organization',
        targetId: id,
        correlationId,
        metadata: { name },
      });
      return { id, name };
    });
  }

  async rename(
    auth: AuthContext,
    organizationId: string,
    name: string,
    correlationId: string,
  ): Promise<void> {
    await withDbContext(this.db, this.ctx(auth, organizationId), async (tx) => {
      const updated = await tx
        .update(organizations)
        .set({ name, updatedAt: sql`now()` })
        .where(eq(organizations.id, organizationId))
        .returning({ id: organizations.id });
      if (updated.length === 0) throw new NotFoundException('Team not found');
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'org.renamed',
        targetType: 'organization',
        targetId: organizationId,
        correlationId,
        metadata: { name },
      });
    });
  }

  async listMembers(auth: AuthContext, organizationId: string): Promise<Member[]> {
    return withDbContext(this.db, this.ctx(auth, organizationId), (tx) =>
      tx
        .select({
          userId: users.id,
          displayName: users.displayName,
          email: users.email,
          role: organizationMemberships.role,
        })
        .from(organizationMemberships)
        .innerJoin(users, eq(users.id, organizationMemberships.userId))
        .where(eq(organizationMemberships.organizationId, organizationId))
        .orderBy(asc(users.displayName)),
    );
  }

  async addMember(
    auth: AuthContext,
    organizationId: string,
    userId: string,
    role: MembershipRole,
    correlationId: string,
  ): Promise<void> {
    this.assertCanAssign(auth, role);
    await withDbContext(this.db, this.ctx(auth, organizationId), async (tx) => {
      const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId));
      if (!user) throw new NotFoundException('User not found in the company directory');
      const inserted = await tx
        .insert(organizationMemberships)
        .values({ organizationId, userId, role, createdBy: auth.userId })
        .onConflictDoNothing()
        .returning({ userId: organizationMemberships.userId });
      if (inserted.length === 0) throw new ConflictException('User is already a member');
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'member.added',
        targetType: 'user',
        targetId: userId,
        correlationId,
        metadata: { role },
      });
    });
  }

  async changeRole(
    auth: AuthContext,
    organizationId: string,
    userId: string,
    role: MembershipRole,
    correlationId: string,
  ): Promise<void> {
    await withDbContext(this.db, this.ctx(auth, organizationId), async (tx) => {
      const current = await this.currentRole(tx, organizationId, userId);
      this.assertCanAssign(auth, role);
      if (current === 'org_owner') this.assertCanAssign(auth, 'org_owner');
      if (current === 'org_owner' && role !== 'org_owner')
        await this.assertNotLastOwner(tx, organizationId);
      await tx
        .update(organizationMemberships)
        .set({ role, updatedAt: sql`now()` })
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'member.role_changed',
        targetType: 'user',
        targetId: userId,
        correlationId,
        metadata: { from: current, to: role },
      });
    });
  }

  async removeMember(
    auth: AuthContext,
    organizationId: string,
    userId: string,
    correlationId: string,
  ): Promise<void> {
    await withDbContext(this.db, this.ctx(auth, organizationId), async (tx) => {
      const current = await this.currentRole(tx, organizationId, userId);
      if (current === 'org_owner') {
        this.assertCanAssign(auth, 'org_owner');
        await this.assertNotLastOwner(tx, organizationId);
      }
      await tx
        .delete(organizationMemberships)
        .where(
          and(
            eq(organizationMemberships.organizationId, organizationId),
            eq(organizationMemberships.userId, userId),
          ),
        );
      await this.audit.record(tx, {
        organizationId,
        actorId: auth.userId,
        action: 'member.removed',
        targetType: 'user',
        targetId: userId,
        correlationId,
        metadata: { role: current },
      });
    });
  }

  /** Company directory search for adding members (single company, so all signed-in users are listed). */
  async searchDirectory(
    auth: AuthContext,
    query: string,
  ): Promise<{ id: string; displayName: string; email: string | null }[]> {
    const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return withDbContext(this.db, { userId: auth.userId }, (tx) =>
      tx
        .select({ id: users.id, displayName: users.displayName, email: users.email })
        .from(users)
        .where(or(ilike(users.displayName, pattern), ilike(users.email, pattern)))
        .orderBy(asc(users.displayName))
        .limit(20),
    );
  }

  private assertCanAssign(auth: AuthContext, role: MembershipRole): void {
    if (!canAssignRole(auth.role, auth.platformAdmin, role))
      throw new ForbiddenException('Only team owners can manage the owner role');
  }

  private async currentRole(
    tx: Database,
    organizationId: string,
    userId: string,
  ): Promise<MembershipRole> {
    const [row] = await tx
      .select({ role: organizationMemberships.role })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.userId, userId),
        ),
      );
    if (!row) throw new NotFoundException('Member not found');
    return row.role;
  }

  private async assertNotLastOwner(tx: Database, organizationId: string): Promise<void> {
    // Lock owner rows so two concurrent demotions cannot both pass the check.
    const owners = await tx
      .select({ userId: organizationMemberships.userId })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.role, 'org_owner'),
        ),
      )
      .for('update');
    if (owners.length <= 1)
      throw new BadRequestException({
        message: 'A team must keep at least one owner',
        code: 'LAST_OWNER',
      });
  }
}
