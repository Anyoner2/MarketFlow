from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from products.models import Product
from stores.models import Store

User = get_user_model()


class ProductCatalogApiTests(APITestCase):
	def setUp(self):
		owner = User.objects.create_user(username='maker', password='A-strong-pass-123')
		self.store = Store.objects.create(owner=owner, name='Good Things', slug='good-things')
		Product.objects.create(store=self.store, name='Open listing', price='12.50', stock_quantity=4)
		Product.objects.create(store=self.store, name='Hidden listing', price='8.00', is_active=False)
		Store.objects.create(owner=owner, name='Closed Shop', slug='closed-shop', is_active=False)

	def test_catalog_is_public_and_hides_inactive_products_and_stores(self):
		response = self.client.get('/api/products/')

		self.assertEqual(response.status_code, 200)
		self.assertEqual(len(response.data), 1)
		self.assertEqual(response.data[0]['name'], 'Open listing')
		self.assertEqual(response.data[0]['image'], '')
