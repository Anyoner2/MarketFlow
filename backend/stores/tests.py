from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from stores.models import Store

User = get_user_model()


class StoreApiTests(APITestCase):
	def test_store_creation_assigns_request_user_as_owner(self):
		owner = User.objects.create_user(username='maker', password='A-strong-pass-123')
		self.client.force_authenticate(owner)

		response = self.client.post(
			'/api/stores/',
			{'name': 'Good Things', 'slug': 'good-things', 'description': 'Useful objects.'},
			format='json',
		)

		self.assertEqual(response.status_code, 201)
		self.assertEqual(Store.objects.get().owner, owner)

	def test_users_cannot_read_or_update_another_users_store(self):
		owner = User.objects.create_user(username='maker', password='A-strong-pass-123')
		other = User.objects.create_user(username='other', password='A-strong-pass-123')
		store = Store.objects.create(owner=owner, name='Good Things', slug='good-things')
		self.client.force_authenticate(other)

		self.assertEqual(self.client.get(f'/api/stores/{store.id}/').status_code, 404)
		self.assertEqual(
			self.client.patch(f'/api/stores/{store.id}/', {'name': 'Taken over'}, format='json').status_code,
			404,
		)
