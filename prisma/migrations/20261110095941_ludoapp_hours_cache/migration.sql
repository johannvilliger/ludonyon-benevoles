-- CreateTable
CREATE TABLE `LudoAppHoursCache` (
    `userId` VARCHAR(191) NOT NULL,
    `totalMinutes` INTEGER NOT NULL,
    `parAnnee` JSON NOT NULL,
    `fetchedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `LudoAppHoursCache` ADD CONSTRAINT `LudoAppHoursCache_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
