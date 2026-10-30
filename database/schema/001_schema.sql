SET NAMES utf8mb4;

CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('SuperAdmin', 'RegionalOfficer', 'Staff') DEFAULT 'Staff',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE logs (
    log_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id INT NULL,
    details JSON NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE SET NULL,
    INDEX idx_logs_entity (entity_type, entity_id),
    INDEX idx_logs_rate (action, ip_address, created_at)
) ENGINE=InnoDB;

CREATE TABLE members (
    member_id INT AUTO_INCREMENT PRIMARY KEY,
    paa_id_number VARCHAR(50) UNIQUE NULL,
    prc_license_number VARCHAR(50) NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    contact_number VARCHAR(20),
    chapter_region VARCHAR(100),
    membership_status ENUM('Active', 'Inactive', 'NonMember') DEFAULT 'NonMember',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE events (
    event_id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    event_type ENUM('Convention', 'General Assembly', 'Seminar', 'Workshop', 'Field Demo') NOT NULL,
    description TEXT,
    venue VARCHAR(255) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    registration_fee DECIMAL(10,2) DEFAULT 0.00,
    cpd_units DECIMAL(4,2) DEFAULT 0.00,
    cpd_min_attendance_pct TINYINT UNSIGNED DEFAULT 80,
    prc_accreditation_no VARCHAR(100) NULL,
    is_active TINYINT(1) DEFAULT 0,
    status ENUM('Draft', 'Active', 'Completed', 'Archived') DEFAULT 'Draft',
    created_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(user_id)
) ENGINE=InnoDB;

CREATE TABLE event_sessions (
    session_id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,
    session_name VARCHAR(100) NOT NULL,
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE event_custom_fields (
    field_id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,
    field_label VARCHAR(100) NOT NULL,
    field_type ENUM('text', 'number', 'select', 'checkbox') NOT NULL,
    field_options JSON NULL,
    is_required TINYINT(1) DEFAULT 0,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE registrations (
    registration_id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,
    member_id INT NOT NULL,
    qr_token VARCHAR(255) UNIQUE NOT NULL,
    payment_status ENUM('Pending', 'Paid', 'Waived', 'Refunded') DEFAULT 'Pending',
    payment_reference VARCHAR(100) NULL,
    amount_paid DECIMAL(10,2) DEFAULT 0.00,
    custom_responses JSON NULL,
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(event_id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE,
    UNIQUE KEY unique_event_member (event_id, member_id)
) ENGINE=InnoDB;

CREATE TABLE attendances (
    attendance_id INT AUTO_INCREMENT PRIMARY KEY,
    registration_id INT NOT NULL,
    session_id INT NOT NULL,
    scanned_by INT NULL,
    device_id VARCHAR(64) NULL,
    client_uuid CHAR(36) NULL,
    check_in_time DATETIME NOT NULL,
    is_offline_sync TINYINT(1) DEFAULT 0,
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES event_sessions(session_id) ON DELETE CASCADE,
    FOREIGN KEY (scanned_by) REFERENCES users(user_id),
    UNIQUE KEY unique_registration_session (registration_id, session_id),
    UNIQUE KEY unique_client_uuid (client_uuid)
) ENGINE=InnoDB;
