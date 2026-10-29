// Point the app's unscoped client at the test database for every test file.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
