from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

User = get_user_model()


class AuthenticationApiTests(APITestCase):
	def test_registration_creates_user_and_returns_tokens(self):
		response = self.client.post(
			'/api/auth/register/',
			{'email': 'maker@example.com', 'password': 'A-strong-pass-123', 'first_name': 'Mara'},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		self.assertIn('access', response.data)
		self.assertIn('refresh', response.data)
		self.assertTrue(User.objects.filter(email='maker@example.com').exists())

	def test_registration_rejects_duplicate_email(self):
		User.objects.create_user(username='maker@example.com', email='maker@example.com', password='A-strong-pass-123')

		response = self.client.post(
			'/api/auth/register/',
			{'email': 'MAKER@example.com', 'password': 'Another-strong-pass-123'},
			format='json',
		)

		self.assertEqual(response.status_code, 400)

	def test_login_issues_tokens_for_email_and_password(self):
		User.objects.create_user(username='maker@example.com', email='maker@example.com', password='A-strong-pass-123')

		response = self.client.post(
			'/api/auth/login/',
			{'email': 'maker@example.com', 'password': 'A-strong-pass-123'},
			format='json',
		)

		self.assertEqual(response.status_code, 200)
		self.assertIn('access', response.data)
		self.assertIn('refresh', response.data)

	def test_login_rejects_invalid_password(self):
		User.objects.create_user(username='maker@example.com', email='maker@example.com', password='A-strong-pass-123')

		response = self.client.post(
			'/api/auth/login/',
			{'email': 'maker@example.com', 'password': 'incorrect'},
			format='json',
		)

		self.assertEqual(response.status_code, 401)

	def test_refresh_issues_a_new_access_token(self):
		user = User.objects.create_user(username='maker@example.com', email='maker@example.com', password='A-strong-pass-123')
		refresh = self.client.post(
			'/api/auth/login/',
			{'email': user.email, 'password': 'A-strong-pass-123'},
			format='json',
		).data['refresh']

		response = self.client.post('/api/auth/refresh/', {'refresh': refresh}, format='json')

		self.assertEqual(response.status_code, 200)
		self.assertIn('access', response.data)
