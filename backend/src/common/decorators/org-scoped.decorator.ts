import { SetMetadata } from '@nestjs/common';

export const ORG_SCOPED_KEY = 'isOrgScoped';

/**
 * Marks a controller (or a single route) as operating inside an organization.
 *
 * OrgContextGuard then requires the caller's token to name an active
 * organization AND verifies a live OrganizationMember row before the handler
 * runs; the membership's role becomes `request.user.role`. Routes without this
 * marker (auth, candidate-account, public jobs) get no organization context —
 * and therefore can never touch tenant data through @CurrentUser.
 */
export const OrgScoped = () => SetMetadata(ORG_SCOPED_KEY, true);
