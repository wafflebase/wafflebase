export class CreateWorkspaceDto {
  name: string;
}

export class UpdateWorkspaceDto {
  name?: string;
  slug?: string;
}

export class CreateInviteDto {
  role?: string;
  expiration?: string;
}
