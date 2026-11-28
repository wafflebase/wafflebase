import { IsString, MaxLength } from 'class-validator';

/**
 * Caps here are generous relative to the service's own rules (the bot-name
 * pattern, the `XXXX-XXXX` code shape) so a bad request gets the service's
 * specific 400 rather than a generic one.
 */
export class CreateBotDto {
  @IsString()
  @MaxLength(200)
  name!: string;
}

/** `POST /auth/pair`: redeem a pairing code for a host's API key. */
export class PairHostDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  /** The key's label in Settings → Bots; trimmed and capped by the service. */
  @IsString()
  @MaxLength(1000)
  hostName!: string;
}

/** One bot as Settings → Bots and `wafflebase bots list` show it. */
export interface BotDto {
  id: number;
  username: string;
  photo: string | null;
  invokers: 'owner' | 'members';
  /** Null once the member who managed it is deleted (`onDelete: SetNull`). */
  owner: { id: number; username: string } | null;
  createdAt: string;
  lastSeenAt: string | null;
  hosts: { apiKeyId: string; name: string; lastUsedAt: string | null }[];
}

export interface PairingCodeDto {
  code: string;
  expiresAt: string;
}

export interface PairResultDto {
  botId: number;
  botName: string;
  workspaceId: string;
  apiKey: string;
}
