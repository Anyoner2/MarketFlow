from django.db import models


class Product(models.Model):
	store = models.ForeignKey('stores.Store', on_delete=models.CASCADE, related_name='products')
	name = models.CharField(max_length=160)
	category = models.CharField(max_length=60, default='Other')
	description = models.TextField(blank=True)
	price = models.DecimalField(max_digits=10, decimal_places=2)
	stock_quantity = models.PositiveIntegerField(default=0)
	image_url = models.URLField(blank=True)
	is_active = models.BooleanField(default=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		ordering = ['-created_at']

	def __str__(self):
		return self.name
