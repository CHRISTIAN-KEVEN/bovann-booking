-- Runs once, when the dev MySQL volume is first created.
-- Disposable database used by the API integration tests (wiped on every run).
CREATE DATABASE IF NOT EXISTS bovann_test CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
GRANT ALL PRIVILEGES ON bovann_test.* TO 'bovann'@'%';
FLUSH PRIVILEGES;
