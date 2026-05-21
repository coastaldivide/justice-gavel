process.env.JWT_SECRET       = 'test_jwt_secret_for_testing_only';
process.env.NODE_ENV         = 'test';
process.env.ANTHROPIC_API_KEY = 'test_key_not_real';
process.env.STRIPE_SECRET    = 'sk_test_fake_for_tests';
process.env.ENCRYPTION_KEY   = 'a'.repeat(64); // 32 bytes hex
