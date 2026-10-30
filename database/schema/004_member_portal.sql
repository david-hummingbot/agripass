-- Member portal: passwordless sign-in links emailed to the address on file.

ALTER TABLE members
    ADD COLUMN last_portal_login_at DATETIME NULL;

CREATE TABLE member_login_tokens (
    token_id INT AUTO_INCREMENT PRIMARY KEY,
    member_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_token_hash (token_hash),
    KEY idx_member_created (member_id, created_at),
    FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
) ENGINE=InnoDB;
