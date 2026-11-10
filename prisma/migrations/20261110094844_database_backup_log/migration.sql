-- CreateTable
CREATE TABLE `DatabaseBackupLog` (
    `id` VARCHAR(191) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `success` BOOLEAN NOT NULL DEFAULT false,
    `fileName` VARCHAR(191) NULL,
    `fileSizeBytes` INTEGER NULL,
    `errorMessage` TEXT NULL,

    INDEX `DatabaseBackupLog_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
