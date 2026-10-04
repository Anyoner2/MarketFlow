from rest_framework import serializers

from .models import Product


class ProductSerializer(serializers.ModelSerializer):
    image = serializers.URLField(source='image_url', read_only=True, allow_blank=True)

    class Meta:
        model = Product
        fields = ['id', 'name', 'category', 'price', 'description', 'image']