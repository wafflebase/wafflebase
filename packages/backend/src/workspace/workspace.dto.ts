export class CreateWorkspaceDto {
  name: string;
}

export class UpdateWorkspaceDto {
  name?: string;
}

export class CreateInviteDto {
  role?: string;
  expiration?: string;
}
