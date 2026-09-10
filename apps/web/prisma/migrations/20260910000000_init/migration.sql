-- CreateEnum
CREATE TYPE "System" AS ENUM ('COC7', 'TOUHOU');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('LOBBY', 'PLAYING', 'COMBAT', 'ENDED');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('KP', 'PLAYER', 'SPECTATOR');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('WEAPON', 'ITEM', 'SPELLCARD', 'ABILITY', 'NPC');

-- CreateEnum
CREATE TYPE "CardScope" AS ENUM ('COMPENDIUM', 'ROOM', 'CHARACTER');

-- CreateEnum
CREATE TYPE "Rarity" AS ENUM ('COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('PORTRAIT', 'AVATAR', 'TOKEN', 'MAP', 'SCENE_BG', 'CARD_ART', 'HANDOUT', 'MUSIC', 'SOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "GridType" AS ENUM ('SQUARE', 'HEX', 'NONE');

-- CreateEnum
CREATE TYPE "LayerType" AS ENUM ('BACKGROUND', 'TILE', 'OBJECT', 'EFFECT', 'FOREGROUND');

-- CreateEnum
CREATE TYPE "WallType" AS ENUM ('WALL', 'DOOR', 'WINDOW', 'DIFFICULT_TERRAIN');

-- CreateEnum
CREATE TYPE "Weather" AS ENUM ('NONE', 'RAIN', 'SNOW', 'FOG', 'STORM', 'SAKURA', 'PETALS');

-- CreateEnum
CREATE TYPE "TimeOfDay" AS ENUM ('DAWN', 'DAY', 'DUSK', 'NIGHT', 'MIDNIGHT');

-- CreateEnum
CREATE TYPE "CombatPhase" AS ENUM ('ATB_CHARGING', 'ACTION', 'RESOLUTION', 'ENDED');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('CHAT', 'DICE', 'SYSTEM', 'COMBAT_LOG', 'IC');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('OOC', 'IC', 'KP_ONLY', 'WHISPER', 'SPECTATOR');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('DANMAKU', 'SPELLCARD', 'DEFEND', 'DODGE', 'COUNTER', 'ITEM', 'FLEE', 'PASS');

-- CreateEnum
CREATE TYPE "Resolution" AS ENUM ('PENDING', 'HIT', 'MISS', 'CRITICAL', 'FUMBLE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RollVisibility" AS ENUM ('PUBLIC', 'DARK', 'SECRET');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePack" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" "System" NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "isBuiltin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "RulePack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RulePackVersion" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RulePackVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleOverrideAudit" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleOverrideAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "system" "System" NOT NULL DEFAULT 'COC7',
    "ownerId" TEXT NOT NULL,
    "rulePackVersionId" TEXT,
    "ruleOverride" JSONB NOT NULL DEFAULT '{}',
    "inviteCode" TEXT NOT NULL,
    "status" "RoomStatus" NOT NULL DEFAULT 'LOBBY',
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'PLAYER',
    "activeCharacterId" TEXT,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT,
    "system" "System" NOT NULL DEFAULT 'COC7',
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewComment" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "playerName" TEXT,
    "occupation" TEXT,
    "age" INTEGER,
    "gender" TEXT,
    "residence" TEXT,
    "str" INTEGER NOT NULL DEFAULT 0,
    "con" INTEGER NOT NULL DEFAULT 0,
    "siz" INTEGER NOT NULL DEFAULT 0,
    "dex" INTEGER NOT NULL DEFAULT 0,
    "app" INTEGER NOT NULL DEFAULT 0,
    "int" INTEGER NOT NULL DEFAULT 0,
    "pow" INTEGER NOT NULL DEFAULT 0,
    "edu" INTEGER NOT NULL DEFAULT 0,
    "luck" INTEGER NOT NULL DEFAULT 0,
    "race" TEXT,
    "raceMods" JSONB,
    "skills" JSONB NOT NULL DEFAULT '{}',
    "backstory" JSONB,
    "hp" INTEGER NOT NULL DEFAULT 0,
    "maxHp" INTEGER NOT NULL DEFAULT 0,
    "mp" INTEGER NOT NULL DEFAULT 0,
    "maxMp" INTEGER NOT NULL DEFAULT 0,
    "san" INTEGER NOT NULL DEFAULT 0,
    "maxSan" INTEGER NOT NULL DEFAULT 0,
    "dp" INTEGER NOT NULL DEFAULT 0,
    "maxDp" INTEGER NOT NULL DEFAULT 0,
    "portraitId" TEXT,
    "avatarId" TEXT,
    "tokenId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "scope" "CardScope" NOT NULL,
    "templateId" TEXT,
    "ownerId" TEXT,
    "characterId" TEXT,
    "roomId" TEXT,
    "type" "CardType" NOT NULL,
    "name" TEXT NOT NULL,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "rarity" "Rarity" NOT NULL DEFAULT 'COMMON',
    "frameColor" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "system" "System" NOT NULL DEFAULT 'COC7',
    "isEquipped" BOOLEAN NOT NULL DEFAULT false,
    "equipSlot" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "pointCost" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "roomId" TEXT,
    "type" "AssetType" NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "url" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "checksum" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Module" (
    "id" TEXT NOT NULL,
    "roomId" TEXT,
    "rulePackVersionId" TEXT,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "author" TEXT,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "content" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "Module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModuleChapter" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "summary" TEXT,

    CONSTRAINT "ModuleChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Encounter" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "roomId" TEXT,
    "sceneId" TEXT,
    "title" TEXT NOT NULL,
    "trigger" TEXT,
    "setup" JSONB NOT NULL DEFAULT '{}',
    "orderIndex" INTEGER NOT NULL,

    CONSTRAINT "Encounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "backgroundId" TEXT,
    "bgMusicId" TEXT,
    "ambientSoundId" TEXT,
    "weather" "Weather" NOT NULL DEFAULT 'NONE',
    "timeOfDay" "TimeOfDay" NOT NULL DEFAULT 'DAY',
    "lighting" TEXT NOT NULL DEFAULT 'normal',
    "filterColor" TEXT,
    "filterOpacity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "narration" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Map" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backgroundId" TEXT,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "gridSize" INTEGER NOT NULL DEFAULT 70,
    "gridType" "GridType" NOT NULL DEFAULT 'SQUARE',
    "bgColor" TEXT NOT NULL DEFAULT '#1a1a2e',
    "showGrid" BOOLEAN NOT NULL DEFAULT true,
    "showFog" BOOLEAN NOT NULL DEFAULT true,
    "fogRevealed" JSONB NOT NULL DEFAULT '[]',
    "initialX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "initialY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "initialZoom" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "Map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapLayer" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "assetId" TEXT,
    "name" TEXT NOT NULL,
    "type" "LayerType" NOT NULL,
    "zIndex" INTEGER NOT NULL,
    "opacity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "offsetX" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "offsetY" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scale" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "MapLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "assetId" TEXT,
    "characterId" TEXT,
    "name" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "size" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "rotation" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "zIndex" INTEGER NOT NULL DEFAULT 0,
    "borderColor" TEXT NOT NULL DEFAULT '#ffffff',
    "showName" BOOLEAN NOT NULL DEFAULT true,
    "showHpBar" BOOLEAN NOT NULL DEFAULT true,
    "isVisible" BOOLEAN NOT NULL DEFAULT true,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wall" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "points" JSONB NOT NULL,
    "type" "WallType" NOT NULL DEFAULT 'WALL',

    CONSTRAINT "Wall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Light" (
    "id" TEXT NOT NULL,
    "mapId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "radius" DOUBLE PRECISION NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#ffaa00',
    "intensity" DOUBLE PRECISION NOT NULL DEFAULT 1,

    CONSTRAINT "Light_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 1,
    "phase" "CombatPhase" NOT NULL DEFAULT 'ATB_CHARGING',
    "tick" INTEGER NOT NULL DEFAULT 0,
    "seed" TEXT NOT NULL,
    "ruleSnapshot" JSONB NOT NULL,
    "ruleSnapshotHash" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Combat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatParticipant" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "characterId" TEXT,
    "isNPC" BOOLEAN NOT NULL DEFAULT false,
    "npcData" JSONB,
    "name" TEXT NOT NULL,
    "atbValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "atbMax" DOUBLE PRECISION NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "currentHp" INTEGER NOT NULL,
    "currentMp" INTEGER NOT NULL,
    "currentSan" INTEGER NOT NULL,
    "currentDp" INTEGER NOT NULL DEFAULT 0,
    "maxHp" INTEGER NOT NULL,
    "maxMp" INTEGER NOT NULL,
    "maxSan" INTEGER NOT NULL,
    "maxDp" INTEGER NOT NULL DEFAULT 0,
    "statusEffects" JSONB NOT NULL DEFAULT '[]',
    "isIdentified" BOOLEAN NOT NULL DEFAULT false,
    "spellState" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "CombatParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatAction" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "ActionType" NOT NULL,
    "payload" JSONB NOT NULL,
    "resolution" "Resolution" NOT NULL DEFAULT 'PENDING',
    "rollValue" INTEGER,
    "rollTarget" INTEGER,
    "damageDealt" INTEGER,
    "rollSeed" TEXT,
    "ruleHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CombatAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombatSnapshot" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CombatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL DEFAULT 'OOC',
    "type" "MessageType" NOT NULL DEFAULT 'CHAT',
    "content" JSONB NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiceRoll" (
    "id" TEXT NOT NULL,
    "roomId" TEXT,
    "userId" TEXT NOT NULL,
    "expression" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "visibility" "RollVisibility" NOT NULL DEFAULT 'PUBLIC',
    "seed" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiceRoll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clue" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "assetId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClueDiscovery" (
    "clueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "discoveredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClueDiscovery_pkey" PRIMARY KEY ("clueId","userId")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isKPOnly" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "RulePack_slug_key" ON "RulePack"("slug");

-- CreateIndex
CREATE INDEX "RulePackVersion_checksum_idx" ON "RulePackVersion"("checksum");

-- CreateIndex
CREATE UNIQUE INDEX "RulePackVersion_packId_version_key" ON "RulePackVersion"("packId", "version");

-- CreateIndex
CREATE INDEX "RuleOverrideAudit_roomId_createdAt_idx" ON "RuleOverrideAudit"("roomId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_inviteCode_key" ON "Room"("inviteCode");

-- CreateIndex
CREATE INDEX "Room_status_idx" ON "Room"("status");

-- CreateIndex
CREATE INDEX "RoomMember_roomId_role_idx" ON "RoomMember"("roomId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_roomId_userId_key" ON "RoomMember"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_portraitId_key" ON "Character"("portraitId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_avatarId_key" ON "Character"("avatarId");

-- CreateIndex
CREATE UNIQUE INDEX "Character_tokenId_key" ON "Character"("tokenId");

-- CreateIndex
CREATE INDEX "Character_userId_idx" ON "Character"("userId");

-- CreateIndex
CREATE INDEX "Character_roomId_reviewStatus_idx" ON "Character"("roomId", "reviewStatus");

-- CreateIndex
CREATE INDEX "Card_characterId_scope_idx" ON "Card"("characterId", "scope");

-- CreateIndex
CREATE INDEX "Card_roomId_type_idx" ON "Card"("roomId", "type");

-- CreateIndex
CREATE INDEX "Card_templateId_idx" ON "Card"("templateId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_roomId_type_idx" ON "Asset"("roomId", "type");

-- CreateIndex
CREATE INDEX "Asset_checksum_idx" ON "Asset"("checksum");

-- CreateIndex
CREATE INDEX "ModuleChapter_moduleId_orderIndex_idx" ON "ModuleChapter"("moduleId", "orderIndex");

-- CreateIndex
CREATE INDEX "Encounter_chapterId_orderIndex_idx" ON "Encounter"("chapterId", "orderIndex");

-- CreateIndex
CREATE INDEX "Scene_roomId_orderIndex_idx" ON "Scene"("roomId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Map_sceneId_key" ON "Map"("sceneId");

-- CreateIndex
CREATE INDEX "Token_mapId_idx" ON "Token"("mapId");

-- CreateIndex
CREATE INDEX "Combat_roomId_endedAt_idx" ON "Combat"("roomId", "endedAt");

-- CreateIndex
CREATE INDEX "CombatParticipant_combatId_idx" ON "CombatParticipant"("combatId");

-- CreateIndex
CREATE INDEX "CombatAction_combatId_createdAt_idx" ON "CombatAction"("combatId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CombatAction_combatId_seq_key" ON "CombatAction"("combatId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "CombatSnapshot_combatId_seq_key" ON "CombatSnapshot"("combatId", "seq");

-- CreateIndex
CREATE INDEX "Message_roomId_createdAt_idx" ON "Message"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "DiceRoll_roomId_createdAt_idx" ON "DiceRoll"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "Clue_roomId_idx" ON "Clue"("roomId");

-- CreateIndex
CREATE INDEX "Note_roomId_userId_idx" ON "Note"("roomId", "userId");

-- AddForeignKey
ALTER TABLE "RulePack" ADD CONSTRAINT "RulePack_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RulePackVersion" ADD CONSTRAINT "RulePackVersion_packId_fkey" FOREIGN KEY ("packId") REFERENCES "RulePack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleOverrideAudit" ADD CONSTRAINT "RuleOverrideAudit_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleOverrideAudit" ADD CONSTRAINT "RuleOverrideAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_rulePackVersionId_fkey" FOREIGN KEY ("rulePackVersionId") REFERENCES "RulePackVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_activeCharacterId_fkey" FOREIGN KEY ("activeCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_portraitId_fkey" FOREIGN KEY ("portraitId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Module" ADD CONSTRAINT "Module_rulePackVersionId_fkey" FOREIGN KEY ("rulePackVersionId") REFERENCES "RulePackVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModuleChapter" ADD CONSTRAINT "ModuleChapter_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "Module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "ModuleChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Encounter" ADD CONSTRAINT "Encounter_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_backgroundId_fkey" FOREIGN KEY ("backgroundId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Map" ADD CONSTRAINT "Map_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Map" ADD CONSTRAINT "Map_backgroundId_fkey" FOREIGN KEY ("backgroundId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapLayer" ADD CONSTRAINT "MapLayer_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapLayer" ADD CONSTRAINT "MapLayer_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wall" ADD CONSTRAINT "Wall_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Light" ADD CONSTRAINT "Light_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combat" ADD CONSTRAINT "Combat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatParticipant" ADD CONSTRAINT "CombatParticipant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatAction" ADD CONSTRAINT "CombatAction_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombatSnapshot" ADD CONSTRAINT "CombatSnapshot_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiceRoll" ADD CONSTRAINT "DiceRoll_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clue" ADD CONSTRAINT "Clue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clue" ADD CONSTRAINT "Clue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueDiscovery" ADD CONSTRAINT "ClueDiscovery_clueId_fkey" FOREIGN KEY ("clueId") REFERENCES "Clue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClueDiscovery" ADD CONSTRAINT "ClueDiscovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 设计约束：Prisma schema 无法表达部分唯一索引，手写补上
-- ---------------------------------------------------------------------------

-- 每个房间最多存在一个未结束的战斗
CREATE UNIQUE INDEX "one_active_combat_per_room"
  ON "Combat" ("roomId") WHERE "endedAt" IS NULL;

-- 每个房间最多存在一个激活场景
CREATE UNIQUE INDEX "one_active_scene_per_room"
  ON "Scene" ("roomId") WHERE "isActive" = true;
